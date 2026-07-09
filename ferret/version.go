//go:build js && wasm

package ferret

type Version struct {
	Self   string `json:"self"`
	Ferret string `json:"ferret"`
}
