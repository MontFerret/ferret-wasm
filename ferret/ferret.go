package ferret

import (
	"context"
	"strconv"
	"syscall/js"
	"time"

	"github.com/MontFerret/ferret/pkg/compiler"
	"github.com/MontFerret/ferret/pkg/runtime"
	"github.com/MontFerret/ferret/pkg/runtime/core"
	"github.com/MontFerret/ferret/pkg/runtime/values"

	"github.com/pkg/errors"
)

type Ferret struct {
	version  Version
	compiler *compiler.FqlCompiler
	programs map[string]*runtime.Program
}

func New(version Version) *Ferret {
	f := new(Ferret)
	f.version = version
	f.compiler = compiler.New()
	f.programs = make(map[string]*runtime.Program)

	return f
}

func (f *Ferret) Version() *Result {
	return OkInterface(f.version)
}

func (f *Ferret) Register(name, fn js.Value) *Result {
	if name.Type() != js.TypeString {
		return Error(TypeError("function name", js.TypeString, name.Type()))
	}

	if fn.Type() != js.TypeFunction {
		return Error(TypeError("function", js.TypeFunction, fn.Type()))
	}

	err := f.compiler.RegisterFunction(name.String(), func(ctx context.Context, args ...core.Value) (value core.Value, e error) {
		jsValues := make([]interface{}, 0, len(args))

		for _, arg := range args {
			jsValues = append(jsValues, toJsValue(arg))
		}

		out := fn.Invoke(jsValues...)

		// check whether a returned value is a promise
		if out.Type() == js.TypeObject && out.Get("then").Type() == js.TypeFunction {
			s := make(chan core.Value)
			f := make(chan error)

			success := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
				result := args[0]

				s <- values.Parse(fromJsValue(result))

				return js.Null()
			})

			defer success.Release()

			failure := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
				reason := args[0]

				f <- errors.New(reason.String())

				return js.Null()
			})

			defer failure.Release()

			go func() {
				out.Call("then", success)
				out.Call("catch", failure)
			}()

			select {
			case val := <-s:
				return val, nil
			case err := <-f:
				return values.None, err
			}
		}

		return values.Parse(fromJsValue(out)), nil
	})

	if err != nil {
		return Error(errors.Wrap(err, "register function"))
	}

	return OkEmpty()
}

func (f *Ferret) Compile(query js.Value) *Result {
	program, err := f.compiler.Compile(query.String())

	if err != nil {
		return Error(errors.Wrap(err, "compile query"))
	}

	id := strconv.Itoa(int(time.Now().UnixNano()))
	f.programs[id] = program

	return Ok([]byte(id))
}

func (f *Ferret) Run(id, params js.Value) *Result {
	program, found := f.programs[id.String()]

	if !found {
		return Error(errors.New("invalid program id"))
	}

	return f.execProgram(program, params)
}

func (f *Ferret) Execute(query, params js.Value) *Result {
	program, err := f.compiler.Compile(query.String())

	if err != nil {
		return Error(errors.Wrap(err, "compile query"))
	}

	return f.execProgram(program, params)
}

func (f *Ferret) execProgram(p *runtime.Program, paramValues js.Value) *Result {
	ctx := context.Background()

	out, err := p.Run(ctx, runtime.WithParams(toParams(paramValues)))

	if err != nil {
		return Error(errors.Wrap(err, "run program"))
	}

	return Ok(out)
}
