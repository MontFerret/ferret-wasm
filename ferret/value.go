//go:build js && wasm

package ferret

import (
	"context"
	"errors"
	"fmt"
	"math"
	"syscall/js"

	encodingjson "github.com/MontFerret/ferret/v2/pkg/encoding/json"
	"github.com/MontFerret/ferret/v2/pkg/runtime"
)

func runtimeValueToJS(value runtime.Value) (js.Value, error) {
	if value == nil || value == runtime.None {
		return js.Null(), nil
	}

	if binary, isBinary := value.(runtime.Binary); isBinary {
		array := js.Global().Get("Uint8Array").New(len(binary))
		js.CopyBytesToJS(array, binary)
		return array, nil
	}

	encoded, err := encodingjson.Default.Encode(value)
	if err != nil {
		return js.Undefined(), err
	}

	return js.Global().Get("JSON").Call("parse", string(encoded)), nil
}

func jsValueToGo(input js.Value) (any, error) {
	return convertJSValue(input, nil, "$")
}

func convertJSValue(input js.Value, seen []js.Value, path string) (any, error) {
	switch input.Type() {
	case js.TypeUndefined, js.TypeNull:
		return nil, nil
	case js.TypeBoolean:
		return input.Bool(), nil
	case js.TypeString:
		return input.String(), nil
	case js.TypeNumber:
		value := input.Float()
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("%s: number must be finite", path)
		}
		return value, nil
	case js.TypeObject:
		return convertJSObject(input, seen, path)
	default:
		return nil, fmt.Errorf("%s: unsupported JavaScript value type %s", path, input.Type())
	}
}

func convertJSObject(input js.Value, seen []js.Value, path string) (any, error) {
	for _, ancestor := range seen {
		if ancestor.Equal(input) {
			return nil, fmt.Errorf("%s: cyclic JavaScript value", path)
		}
	}

	seen = append(seen, input)

	global := js.Global()
	if input.InstanceOf(global.Get("Uint8Array")) {
		out := make([]byte, input.Get("byteLength").Int())
		js.CopyBytesToGo(out, input)
		return out, nil
	}

	if global.Get("Array").Call("isArray", input).Bool() {
		out := make([]any, input.Length())

		for index := 0; index < input.Length(); index++ {
			value, err := convertJSValue(input.Index(index), seen, fmt.Sprintf("%s[%d]", path, index))
			if err != nil {
				return nil, err
			}

			out[index] = value
		}

		return out, nil
	}

	object := global.Get("Object")
	prototype := object.Call("getPrototypeOf", input)

	if !prototype.IsNull() && !prototype.Equal(object.Get("prototype")) {
		return nil, fmt.Errorf("%s: only plain JavaScript objects are supported", path)
	}

	keys := object.Call("keys", input)
	out := make(map[string]any, keys.Length())

	for index := 0; index < keys.Length(); index++ {
		key := keys.Index(index).String()
		value, err := convertJSValue(input.Get(key), seen, path+"."+key)

		if err != nil {
			return nil, err
		}

		out[key] = value
	}

	return out, nil
}

func jsParams(input js.Value) (map[string]any, error) {
	if input.Type() == js.TypeUndefined || input.Type() == js.TypeNull {
		return nil, nil
	}

	value, err := jsValueToGo(input)
	if err != nil {
		return nil, err
	}

	params, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("params must be a plain JavaScript object")
	}

	return params, nil
}

func invokeRuntimeFunction(ctx context.Context, fn js.Value, args ...runtime.Value) (runtime.Value, error) {
	jsArgs := make([]any, len(args))

	for index, arg := range args {
		value, err := runtimeValueToJS(arg)
		if err != nil {
			return runtime.None, fmt.Errorf("convert argument %d: %w", index, err)
		}

		jsArgs[index] = value
	}

	var output js.Value
	var invokeErr error

	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				invokeErr = fmt.Errorf("JavaScript function panicked: %v", recovered)
			}
		}()

		output = fn.Invoke(jsArgs...)
	}()

	if invokeErr != nil {
		return runtime.None, invokeErr
	}

	if output.Type() != js.TypeObject || output.Get("then").Type() != js.TypeFunction {
		return parseFunctionOutput(output)
	}

	type settled struct {
		value runtime.Value
		err   error
	}

	result := make(chan settled, 1)

	var success js.Func
	var rejected js.Func

	success = js.FuncOf(func(_ js.Value, values []js.Value) any {
		value := js.Undefined()

		if len(values) > 0 {
			value = values[0]
		}

		parsed, err := parseFunctionOutput(value)

		select {
		case result <- settled{value: parsed, err: err}:
		default:
		}

		go func() {
			success.Release()
			rejected.Release()
		}()

		return nil
	})

	rejected = js.FuncOf(func(_ js.Value, values []js.Value) any {
		message := "JavaScript promise rejected"

		if len(values) > 0 {
			message = js.Global().Get("String").Invoke(values[0]).String()
		}

		select {
		case result <- settled{err: errors.New(message)}:
		default:
		}

		go func() {
			success.Release()
			rejected.Release()
		}()

		return nil
	})

	output.Call("then", success, rejected)

	select {
	case <-ctx.Done():
		// A JavaScript Promise cannot be cancelled generically. Keep the Go
		// runtime alive until it settles so its callbacks can never resume an
		// already-shut-down WASM instance, but preserve cancellation as the
		// result observed by the Ferret session.
		<-result
		return runtime.None, ctx.Err()
	case settled := <-result:
		if ctx.Err() != nil {
			return runtime.None, ctx.Err()
		}
		return settled.value, settled.err
	}
}

func parseFunctionOutput(output js.Value) (runtime.Value, error) {
	value, err := jsValueToGo(output)
	if err != nil {
		return runtime.None, err
	}

	parsed, err := runtime.ValueOf(value)
	if err != nil {
		return runtime.None, err
	}

	return parsed, nil
}
