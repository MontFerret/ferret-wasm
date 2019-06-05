export GOPATH
export GO111MODULE=on
export GOOS=js
export GOARCH=wasm
export NODE_ENV=production

VERSION?=$(shell git describe --tags --always --dirty)
DIR_BIN=./dist
NODE_BIN=./node_modules/.bin
GO_ROOT=$(go env GOROOT)

install:
	go mod vendor && go get

compile:
	rm -rf ${DIR_BIN} && \
	go build -v -o ${DIR_BIN}/ferret.wasm -ldflags "-X main.version=${VERSION}" main.go && \
	${NODE_BIN}/tsc -b ./tsconfig.json