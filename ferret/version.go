//go:build js && wasm

package ferret

type Version struct {
	WASM   string `json:"wasm"`
	Ferret string `json:"ferret"`
}
