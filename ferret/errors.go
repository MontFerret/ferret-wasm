package ferret

import (
	"github.com/pkg/errors"
	"syscall/js"
)

func TypeError(name string, expected, actual js.Type) error {
	return errors.Errorf("Expected %s to be '%s', but got '%s'", name, expected.String(), actual.String())
}
