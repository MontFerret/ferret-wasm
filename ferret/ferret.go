package ferret

import (
	"context"
	"strconv"
	"syscall/js"
	"time"

	"github.com/MontFerret/ferret/pkg/compiler"
	"github.com/MontFerret/ferret/pkg/runtime"

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

func (f *Ferret) Version() *Result {
	return Ok([]byte(f.version))
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
