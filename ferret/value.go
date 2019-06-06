package ferret

import (
	"github.com/MontFerret/ferret/pkg/runtime/core"
	"syscall/js"
)

func fromJsValue(input js.Value) interface{} {
	switch input.Type() {
	case js.TypeBoolean:
		return input.Bool()
	case js.TypeString:
		return input.String()
	case js.TypeNumber:
		return input.Float()
	case js.TypeObject:
		res := make(map[string]interface{})

		keys := js.Global().Get("Object").Call("keys", input)

		for i := 0; i < keys.Length(); i++ {
			key := keys.Index(i)
			value := input.Get(key.String())

			res[key.String()] = fromJsValue(value)
		}

		return res
	case js.TypeNull, js.TypeUndefined:
		return nil
	default:
		isArray := js.Global().Get("Array").Call("isArray", input)

		if isArray.Truthy() {
			res := make([]interface{}, 0, input.Length())

			for i := 0; i < input.Length(); i++ {
				res = append(res, fromJsValue(input.Index(i)))
			}

			return res
		}

		return nil
	}
}

func toJsValue(input interface{}) js.Value {
	switch v := input.(type) {
	case core.Value:
		return js.ValueOf(v.Unwrap())
	default:
		return js.ValueOf(v)
	}
}

func toParams(input js.Value) map[string]interface{} {
	params := make(map[string]interface{})

	if input.Type() == js.TypeObject {
		keys := js.Global().Get("Object").Call("keys", input)

		for i := 0; i < keys.Length(); i++ {
			key := keys.Index(i)
			value := input.Get(key.String())

			params[key.String()] = fromJsValue(value)
		}
	}

	return params
}
