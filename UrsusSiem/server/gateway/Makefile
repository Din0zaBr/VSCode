.PHONY: help build test geoip-testdata

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

build: ## Build the gateway binary
	go build -o bin/gateway ./...

test: ## Run the full test suite (race detector on)
	go test ./... -race

geoip-testdata: ## Fetch the MaxMind test MMDB for go test
	@curl -fsSL \
	  https://raw.githubusercontent.com/maxmind/MaxMind-DB/main/test-data/GeoIP2-City-Test.mmdb \
	  -o internal/geoip/testdata/GeoIP2-City-Test.mmdb
	@echo "OK fetched internal/geoip/testdata/GeoIP2-City-Test.mmdb"
