#!/bin/bash

if [ "$1" = 'ferret' ]; then
  echo $(cat go.mod | grep 'github.com/MontFerret/ferret/' | awk '{print $3}' | sed 's/^v//')
else
  echo $(node -p "require('./package.json').version")
fi