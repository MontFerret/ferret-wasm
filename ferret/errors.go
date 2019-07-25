package ferret

import (
	"syscall/js"

	"github.com/pkg/errors"
)

func TypeError(name string, expected, actual js.Type) error {
	return errors.Errorf("Expected %s to be '%s', but got '%s'", name, expected.String(), actual.String())
}
