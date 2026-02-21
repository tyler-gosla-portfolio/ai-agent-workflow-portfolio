.PHONY: build test clean install lint

install:
	npm install

build: install
	npm run build

test: install
	npm test

lint: install
	npm run lint

clean:
	npm run clean
