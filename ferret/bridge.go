//go:build js && wasm

package ferret

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"syscall/js"

	core "github.com/MontFerret/ferret/v2"
	"github.com/MontFerret/ferret/v2/pkg/runtime"
	"github.com/MontFerret/ferret/v2/pkg/source"
)

type (
	planHandle struct {
		plan                    *core.Plan
		sessions                map[string]*sessionHandle
		pendingSessionCreations int
		closed                  bool
	}

	sessionHandle struct {
		session *core.Session
		planID  string
		running bool
		closed  bool
	}

	Bridge struct {
		mu        sync.Mutex
		engine    *core.Engine
		plans     map[string]*planHandle
		sessions  map[string]*sessionHandle
		methods   []js.Func
		version   Version
		nextID    atomic.Uint64
		shutdown  func()
		closed    bool
		compiling int
	}
)

func NewBridge(version Version, shutdown func()) *Bridge {
	return &Bridge{
		plans:    make(map[string]*planHandle),
		sessions: make(map[string]*sessionHandle),
		version:  version,
		shutdown: sync.OnceFunc(shutdown),
	}
}

func (b *Bridge) JSValue() js.Value {
	object := js.Global().Get("Object").New()
	b.setMethod(object, "initialize", b.initialize)
	b.setMethod(object, "version", b.getVersion)
	b.setMethod(object, "compile", b.compile)
	b.setMethod(object, "createSession", b.createSession)
	b.setMethod(object, "runSession", b.runSession)
	b.setMethod(object, "closeSession", b.closeSession)
	b.setMethod(object, "closePlan", b.closePlan)
	b.setMethod(object, "closeEngine", b.closeEngine)
	b.setMethod(object, "shutdown", b.shutdownRuntime)
	return object
}

func (b *Bridge) setMethod(object js.Value, name string, method func(js.Value, []js.Value) any) {
	fn := js.FuncOf(method)
	b.methods = append(b.methods, fn)
	object.Set(name, fn)
}

func (b *Bridge) initialize(_ js.Value, args []js.Value) any {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.engine != nil {
		return failure(errors.New("engine is already initialized"))
	}
	if b.closed {
		return failure(errors.New("engine is closed"))
	}

	functions := js.Undefined()

	if len(args) > 0 {
		functions = args[0]
	}

	registered, err := parseFunctions(functions)
	if err != nil {
		return failure(err)
	}

	options := make([]core.Option, 0, 1)

	if len(registered) > 0 {
		options = append(options, core.WithFunctionsRegistrar(func(namespace runtime.Namespace) {
			definitions := namespace.Function().Var()

			for name, function := range registered {
				fn := function
				definitions.Add(name, func(ctx context.Context, args ...runtime.Value) (runtime.Value, error) {
					return invokeRuntimeFunction(ctx, fn, args...)
				})
			}
		}))
	}

	engine, err := core.New(options...)
	if err != nil {
		return failure(fmt.Errorf("initialize engine: %w", err))
	}

	b.engine = engine

	return ok(nil)
}

func parseFunctions(input js.Value) (map[string]js.Value, error) {
	if input.Type() == js.TypeUndefined || input.Type() == js.TypeNull {
		return nil, nil
	}
	if input.Type() != js.TypeObject {
		return nil, errors.New("functions must be a plain JavaScript object")
	}

	object := js.Global().Get("Object")
	prototype := object.Call("getPrototypeOf", input)

	if !prototype.IsNull() && !prototype.Equal(object.Get("prototype")) {
		return nil, errors.New("functions must be a plain JavaScript object")
	}

	keys := object.Call("keys", input)
	functions := make(map[string]js.Value, keys.Length())

	for index := 0; index < keys.Length(); index++ {
		rawName := keys.Index(index).String()
		name := strings.ToUpper(strings.TrimSpace(rawName))

		if name == "" {
			return nil, errors.New("function name cannot be empty")
		}
		if _, duplicate := functions[name]; duplicate {
			return nil, fmt.Errorf("duplicate function name %q", name)
		}

		function := input.Get(rawName)
		if function.Type() != js.TypeFunction {
			return nil, fmt.Errorf("function %q must be callable", rawName)
		}

		functions[name] = function
	}

	return functions, nil
}

func (b *Bridge) getVersion(_ js.Value, _ []js.Value) any {
	return ok(map[string]any{
		"wasm":   b.version.WASM,
		"ferret": b.version.Ferret,
	})
}

func (b *Bridge) compile(_ js.Value, args []js.Value) any {
	if len(args) < 4 {
		return failure(errors.New("source name, text, signal, and callback are required"))
	}

	name := args[0].String()
	text := args[1].String()
	signal := args[2]
	callback := args[3]

	if callback.Type() != js.TypeFunction {
		return failure(errors.New("callback must be callable"))
	}

	b.mu.Lock()
	if b.closed || b.engine == nil {
		b.mu.Unlock()
		return failure(errors.New("engine is closed"))
	}
	engine := b.engine
	b.compiling++
	b.mu.Unlock()

	go func() {
		result := func() any {
			ctx, cleanup, err := contextFromSignal(signal)
			if err != nil {
				return failure(err)
			}
			defer cleanup()

			if err := ctx.Err(); err != nil {
				return failure(err)
			}

			plan, err := engine.Compile(ctx, source.New(name, text))
			if err != nil {
				return failure(fmt.Errorf("compile query: %w", err))
			}

			if err := ctx.Err(); err != nil {
				_ = plan.Close()
				return failure(err)
			}

			id := b.newID("plan")
			params := plan.Params()
			paramValues := make([]any, len(params))

			for index, param := range params {
				paramValues[index] = param
			}

			b.mu.Lock()
			if b.closed {
				b.mu.Unlock()
				_ = plan.Close()
				return failure(errors.New("engine is closed"))
			}
			b.plans[id] = &planHandle{plan: plan, sessions: make(map[string]*sessionHandle)}
			b.mu.Unlock()

			return ok(map[string]any{"id": id, "params": paramValues})
		}()

		b.mu.Lock()
		b.compiling--
		b.mu.Unlock()

		invoke(callback, result)
	}()

	return ok(nil)
}

func (b *Bridge) createSession(_ js.Value, args []js.Value) any {
	if len(args) < 4 {
		return failure(errors.New("plan id, params, signal, and callback are required"))
	}

	planID := args[0].String()
	params := args[1]
	signal := args[2]
	callback := args[3]

	if callback.Type() != js.TypeFunction {
		return failure(errors.New("callback must be callable"))
	}

	parsed, err := jsParams(params)
	if err != nil {
		return failure(fmt.Errorf("convert params: %w", err))
	}

	b.mu.Lock()
	handle, exists := b.plans[planID]

	if !exists || handle.closed || b.closed {
		b.mu.Unlock()
		return failure(errors.New("plan is closed"))
	}

	plan := handle.plan
	handle.pendingSessionCreations++
	b.mu.Unlock()

	go func() {
		result := func() any {
			ctx, cleanup, err := contextFromSignal(signal)
			if err != nil {
				return failure(err)
			}
			defer cleanup()

			if err := ctx.Err(); err != nil {
				return failure(err)
			}

			options := make([]core.SessionOption, 0, 1)
			if len(parsed) > 0 {
				options = append(options, core.WithSessionParams(parsed))
			}

			session, err := plan.NewSession(ctx, options...)
			if err != nil {
				return failure(fmt.Errorf("create session: %w", err))
			}

			if err := ctx.Err(); err != nil {
				_ = session.Close()
				return failure(err)
			}

			id := b.newID("session")
			sessionHandle := &sessionHandle{session: session, planID: planID}

			b.mu.Lock()
			handle, exists = b.plans[planID]
			if !exists || handle.closed || b.closed {
				b.mu.Unlock()
				_ = session.Close()
				return failure(errors.New("plan is closed"))
			}
			handle.sessions[id] = sessionHandle
			b.sessions[id] = sessionHandle
			b.mu.Unlock()

			return ok(id)
		}()

		b.mu.Lock()
		if current, found := b.plans[planID]; found {
			current.pendingSessionCreations--
		}
		b.mu.Unlock()

		invoke(callback, result)
	}()

	return ok(nil)
}

func (b *Bridge) runSession(_ js.Value, args []js.Value) any {
	if len(args) < 3 {
		return failure(errors.New("session id, signal, and callback are required"))
	}

	id := args[0].String()
	signal := args[1]
	callback := args[2]

	if callback.Type() != js.TypeFunction {
		return failure(errors.New("callback must be callable"))
	}

	b.mu.Lock()
	handle, exists := b.sessions[id]
	if !exists || handle.closed {
		b.mu.Unlock()
		return failure(errors.New("session is closed"))
	}

	if handle.running {
		b.mu.Unlock()
		return failure(errors.New("session is already running"))
	}

	handle.running = true
	session := handle.session
	b.mu.Unlock()

	go func() {
		result := func() any {
			ctx, cleanup, err := contextFromSignal(signal)
			if err != nil {
				return failure(err)
			}
			defer cleanup()

			output, runErr := session.Run(ctx)
			if runErr != nil {
				return failure(fmt.Errorf("run session: %w", runErr))
			}

			return ok(string(output.Content))
		}()

		b.finishRun(id)
		invoke(callback, result)
	}()

	return ok(nil)
}

func contextFromSignal(signal js.Value) (context.Context, func(), error) {
	ctx, cancel := context.WithCancel(context.Background())
	if signal.Type() == js.TypeUndefined || signal.Type() == js.TypeNull {
		return ctx, cancel, nil
	}

	if signal.Type() != js.TypeObject ||
		signal.Get("addEventListener").Type() != js.TypeFunction ||
		signal.Get("removeEventListener").Type() != js.TypeFunction {
		cancel()
		return nil, func() {}, errors.New("signal must be an AbortSignal")
	}

	if signal.Get("aborted").Bool() {
		cancel()
		return ctx, cancel, nil
	}

	abort := js.FuncOf(func(_ js.Value, _ []js.Value) any {
		cancel()
		return nil
	})

	signal.Call("addEventListener", "abort", abort)

	cleanup := func() {
		signal.Call("removeEventListener", "abort", abort)
		abort.Release()
		cancel()
	}

	return ctx, cleanup, nil
}

func (b *Bridge) finishRun(id string) {
	b.mu.Lock()

	if handle, exists := b.sessions[id]; exists {
		handle.running = false
	}

	b.mu.Unlock()
}

func (b *Bridge) closeSession(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return failure(errors.New("session id is required"))
	}

	return resultFromError(b.closeSessionByID(args[0].String()))
}

func (b *Bridge) closeSessionByID(id string) error {
	b.mu.Lock()
	handle, exists := b.sessions[id]

	if !exists || handle.closed {
		b.mu.Unlock()
		return nil
	}

	if handle.running {
		b.mu.Unlock()
		return errors.New("cannot close a running session")
	}

	handle.closed = true
	delete(b.sessions, id)

	if plan, found := b.plans[handle.planID]; found {
		delete(plan.sessions, id)
	}

	b.mu.Unlock()

	return handle.session.Close()
}

func (b *Bridge) closePlan(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return failure(errors.New("plan id is required"))
	}

	return resultFromError(b.closePlanByID(args[0].String()))
}

func (b *Bridge) closePlanByID(id string) error {
	b.mu.Lock()
	handle, exists := b.plans[id]

	if !exists || handle.closed {
		b.mu.Unlock()
		return nil
	}

	if handle.pendingSessionCreations > 0 {
		b.mu.Unlock()
		return errors.New("cannot close a plan while creating a session")
	}

	for _, session := range handle.sessions {
		if session.running {
			b.mu.Unlock()

			return errors.New("cannot close a plan with a running session")
		}
	}

	sessionIDs := make([]string, 0, len(handle.sessions))
	for sessionID := range handle.sessions {
		sessionIDs = append(sessionIDs, sessionID)
	}
	b.mu.Unlock()

	var closeErr error
	for _, sessionID := range sessionIDs {
		closeErr = errors.Join(closeErr, b.closeSessionByID(sessionID))
	}

	b.mu.Lock()
	handle, exists = b.plans[id]
	if !exists || handle.closed {
		b.mu.Unlock()
		return closeErr
	}
	handle.closed = true
	delete(b.plans, id)
	b.mu.Unlock()

	return errors.Join(closeErr, handle.plan.Close())
}

func (b *Bridge) closeEngine(_ js.Value, _ []js.Value) any {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return ok(nil)
	}

	if b.compiling > 0 {
		b.mu.Unlock()
		return failure(errors.New("cannot close an engine while compiling a plan"))
	}

	for _, plan := range b.plans {
		if plan.pendingSessionCreations > 0 {
			b.mu.Unlock()
			return failure(errors.New("cannot close an engine while creating a session"))
		}
	}

	for _, session := range b.sessions {
		if session.running {
			b.mu.Unlock()
			return failure(errors.New("cannot close an engine with a running session"))
		}
	}

	planIDs := make([]string, 0, len(b.plans))
	for id := range b.plans {
		planIDs = append(planIDs, id)
	}

	engine := b.engine
	b.mu.Unlock()

	var closeErr error
	for _, id := range planIDs {
		closeErr = errors.Join(closeErr, b.closePlanByID(id))
	}

	if engine != nil {
		closeErr = errors.Join(closeErr, engine.Close())
	}

	b.mu.Lock()
	b.closed = true
	b.engine = nil
	b.mu.Unlock()

	return resultFromError(closeErr)
}

func (b *Bridge) shutdownRuntime(_ js.Value, _ []js.Value) any {
	b.mu.Lock()
	closed := b.closed
	b.mu.Unlock()

	if !closed {
		return failure(errors.New("engine must be closed before shutdown"))
	}

	b.shutdown()

	return ok(nil)
}

func (b *Bridge) newID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, b.nextID.Add(1))
}

func resultFromError(err error) any {
	if err != nil {
		return failure(err)
	}

	return ok(nil)
}
