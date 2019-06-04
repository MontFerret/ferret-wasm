package ferret

import (
	"context"
	"syscall/js"

	"github.com/MontFerret/ferret/pkg/compiler"
	"github.com/MontFerret/ferret/pkg/runtime"

	"github.com/gofrs/uuid"
	"github.com/pkg/errors"
)

type Ferret struct {
	version  string
	compiler *compiler.FqlCompiler
	programs map[string]*runtime.Program
}

func New(version string) *Ferret {
	f := new(Ferret)
	f.version = version
	f.compiler = compiler.New()
	f.programs = make(map[string]*runtime.Program)

	return f
}

func (f *Ferret) Version(this js.Value, args []js.Value) *Result {
	return Ok([]byte(f.version))
}

func (f *Ferret) Compile(this js.Value, args []js.Value) *Result {
	if len(args) == 0 {
		return Error(errors.New("missed query"))
	}

	program, err := f.compiler.Compile(args[0].String())

	if err != nil {
		return Error(errors.Wrap(err, "compile query"))
	}

	id, err := uuid.NewV4()

	if err != nil {
		return Error(err)
	}

	idStr := id.String()

	f.programs[idStr] = program

	return Ok([]byte(idStr))
}

func (f *Ferret) Run(this js.Value, args []js.Value) *Result {
	if len(args) == 0 {
		return Error(errors.New("missed program id"))
	}

	program, found := f.programs[args[0].String()]

	if !found {
		return Error(errors.New("invalid program id"))
	}

	return f.execProgram(program, args[1:])
}

func (f *Ferret) Execute(this js.Value, args []js.Value) *Result {
	if len(args) == 0 {
		return Error(errors.New("missed query"))
	}

	program, err := f.compiler.Compile(args[0].String())

	if err != nil {
		return Error(errors.Wrap(err, "compile query"))
	}

	return f.execProgram(program, args[1:])
}

func (f *Ferret) execProgram(p *runtime.Program, args []js.Value) *Result {
	params := make(map[string]interface{})

	//if len(args) > 0 {
	//	arg := args[0]
	//
	//	if arg.Type() == js.TypeObject {
	//		keys := js.Global().Get("Object").Call("keys", arg)
	//
	//		if arg.Type() == js.TypedArray {
	//
	//		}
	//	}
	//}

	ctx := context.Background()

	out, err := p.Run(ctx, runtime.WithParams(params))

	if err != nil {
		return Error(errors.Wrap(err, "run program"))
	}

	return Ok(out)
}
