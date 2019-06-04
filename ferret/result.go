package ferret

import (
	"encoding/json"
	"syscall/js"
)

type Result struct {
	data []byte
	err  error
}

func Ok(data []byte) *Result {
	return &Result{data, nil}
}

func Error(err error) *Result {
	return &Result{nil, err}
}

func (r *Result) JSValue() js.Value {
	obj := make(map[string]interface{})

	if r.data != nil {
		var values interface{}

		err := json.Unmarshal(r.data, &values)

		if err == nil {
			obj["data"] = values
		} else {
			r.err = err
		}
	}

	if r.err != nil {
		obj["error"] = r.err.Error()
		obj["ok"] = false
	} else {
		obj["ok"] = true
	}

	return js.ValueOf(obj)
}
