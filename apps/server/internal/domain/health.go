package domain

type Health struct {
	Status      string `json:"status"`
	Version     string `json:"version"`
	Environment string `json:"environment"`
	Database    string `json:"database"`
}
