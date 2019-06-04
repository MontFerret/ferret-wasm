export GOPATH
export GO111MODULE=on
export GOOS=js
export GOARCH=wasm

VERSION?=$(shell git describe --tags --always --dirty)
DIR_BIN=./lib
GO_ROOT=$(go env GOROOT)

install:
	go mod vendor && go get

compile:
	rm -rf ${DIR_BIN} && \
	go build -v -o ${DIR_BIN}/ferret.wasm -ldflags "-X main.version=${VERSION}" main.go