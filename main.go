// +build js,wasm

package main

import (
	"github.com/MontFerret/ferret-wasm/ferret"
	"github.com/pkg/errors"
	"syscall/js"
)

const namespace = "ferret"

var (
	version       = "undefined"
	ferretVersion = "undefined"
)

func notify(callback js.Value, res *ferret.Result) {
	if res.Ok() {
		callback.Invoke(js.Undefined(), res.Data())
	} else {
		callback.Invoke(res.Error(), js.Undefined())
	}
}

func main() {
	c := make(chan struct{}, 0)

	f := ferret.New(ferret.Version{version, ferretVersion})

	js.Global().Set(namespace, make(map[string]interface{}))

	module := js.Global().Get(namespace)
	module.Set("version", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		return js.ValueOf(f.Version())
	}))
	module.Set("compile", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		if len(args) < 1 {
			return ferret.Error(errors.New("Missed query"))
		}

		return f.Compile(args[0])
	}))
	module.Set("run", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		if len(args) < 3 {
			return ferret.Error(errors.New("Missed arguments"))
		}

		id := args[0]
		params := args[1]
		callback := args[2]

		go func() {
			notify(callback, f.Run(id, params))
		}()

		return ferret.OkEmpty()
	}))
	module.Set("exec", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		if len(args) < 3 {
			return ferret.Error(errors.New("Missed arguments"))
		}

		query := args[0]
		params := args[1]
		callback := args[2]

		go func() {
			notify(callback, f.Execute(query, params))
		}()

		return ferret.OkEmpty()
	}))

	<-c
}
