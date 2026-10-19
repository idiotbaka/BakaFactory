package catalog

import (
	"bakafactory/server/internal/domain"
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
)

//go:embed definitions.json
var definitions []byte

func Load() (domain.Catalog, error) {
	var result domain.Catalog
	decoder := json.NewDecoder(bytes.NewReader(definitions))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return result, fmt.Errorf("invalid catalog JSON")
	}
	return result, result.Validate()
}
