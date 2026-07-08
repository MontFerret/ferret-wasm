//go:build js && wasm

package ferret

import (
	"context"
	"errors"
	"syscall/js"
)

const abortCode = "ABORTED"

func ok(data any) any {
	out := map[string]any{"ok": true}

	if data != nil {
		out["data"] = data
	}

	return out
}

func failure(err error) any {
	if err == nil {
		err = errors.New("unexpected error")
	}

	code := ""
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		code = abortCode
	}

	return map[string]any{
		"ok": false,
		"error": map[string]any{
			"message": err.Error(),
			"code":    code,
		},
	}
}

func invoke(callback js.Value, result any) {
	callback.Invoke(js.ValueOf(result))
}
