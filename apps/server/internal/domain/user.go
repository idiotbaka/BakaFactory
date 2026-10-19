package domain

import "errors"

var (
	ErrValidation      = errors.New("invalid input")
	ErrUsernameTaken   = errors.New("username taken")
	ErrCredentials     = errors.New("invalid credentials")
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrAuthBusy        = errors.New("authentication busy")
)

type User struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	CreatedAt   string `json:"created_at"`
	LastLoginAt string `json:"last_login_at"`
}
type Account struct {
	User
	PasswordHash string `json:"-"`
}
type Session struct {
	TokenHash, UserID    string
	CreatedAt, ExpiresAt int64
}
