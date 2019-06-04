// +build js wasm

package main

import (
	"github.com/MontFerret/ferret-wasm/ferret"
	"syscall/js"
)

const namespace = "ferret"

var version = "undefined"

func main() {
	c := make(chan struct{}, 0)

	f := ferret.New(version)

	js.Global().Set(namespace, make(map[string]interface{}))

	module := js.Global().Get(namespace)
	module.Set("version", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		return f.Version(this, args)
	}))
	module.Set("compile", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		return f.Compile(this, args)
	}))
	module.Set("run", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		return f.Run(this, args)
	}))
	module.Set("exec", js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		return f.Execute(this, args)
	}))

	<-c
}
