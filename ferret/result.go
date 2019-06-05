package ferret

import (
	"encoding/json"
	"syscall/js"
)

type Result struct {
	data    interface{}
	err     error
	hasData bool
}

func OkEmpty() *Result {
	return &Result{}
}

func Ok(data []byte) *Result {
	var values interface{}

	err := json.Unmarshal(data, &values)

	if err == nil {
		return &Result{values, nil, true}
	}

	return &Result{nil, err, false}
}

func Error(err error) *Result {
	return &Result{nil, err, false}
}

func (r *Result) Ok() bool {
	return r.err == nil
}

func (r *Result) Error() js.Value {
	if r.err != nil {
		return js.ValueOf(r.err.Error())
	}

	return js.Undefined()
}

func (r *Result) Data() js.Value {
	if r.hasData {
		return js.ValueOf(r.data)
	}

	return js.Undefined()
}

func (r *Result) JSValue() js.Value {
	obj := make(map[string]interface{})

	if r.hasData {
		obj["data"] = r.data
	}

	if r.err != nil {
		obj["error"] = r.err.Error()
		obj["ok"] = false
	} else {
		obj["ok"] = true
	}

	return js.ValueOf(obj)
}
