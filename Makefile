export GOPATH
export GO111MODULE=on
export GOOS=js
export GOARCH=wasm
export NODE_ENV=production

PACKAGE_VERSION?=$(shell node -pe "require('./package.json').version")
FERRET_VERSION=0.8.2
DIR_BIN=./dist
NODE_BIN=./node_modules/.bin
GO_ROOT=$(go env GOROOT)

default: build

build: install compile test

install:
	go mod vendor && go mod tidy

compile:
	rm -rf ${DIR_BIN} && \
	go build -v -o ${DIR_BIN}/ferret.wasm -ldflags "-X main.version=${PACKAGE_VERSION} -X main.ferretVersion=${FERRET_VERSION}" main.go && \
	${NODE_BIN}/tsc -b ./tsconfig.json

test:
	${NODE_BIN}/mocha

fmt:
	go fmt ./ferret/... && \
	${NODE_BIN}/pretty-quick

publish:
	npm publish --access=public