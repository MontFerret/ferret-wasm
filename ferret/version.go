package ferret

import "syscall/js"

type Version struct {
	Self   string `json:"self"`
	Ferret string `json:"ferret"`
}

func (v Version) JSValue() js.Value {
	obj := make(map[string]interface{})

	obj["self"] = v.Self
	obj["ferret"] = v.Ferret

	return js.ValueOf(obj)
}
