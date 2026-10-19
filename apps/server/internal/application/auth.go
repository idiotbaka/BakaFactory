package application

import (
	"bakafactory/server/internal/domain"
	"bakafactory/server/internal/password"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type AccountRepository interface {
	Find(context.Context, string) (domain.Account, error)
	Create(context.Context, domain.Account, domain.Session, string) error
	Login(context.Context, domain.User, domain.Session, string) error
	Current(context.Context, string, int64) (domain.User, error)
	UpdateProfile(context.Context, string, int64, string) (domain.User, error)
	Logout(context.Context, string) error
}
type AuthService struct {
	repository AccountRepository
	ttl        time.Duration
	now        func() time.Time
	dummyHash  string
	slots      chan struct{}
}
type Authentication struct {
	User      domain.User
	Token     string
	ExpiresAt time.Time
}

func NewAuthService(repo AccountRepository, ttl time.Duration) *AuthService {
	return &AuthService{repository: repo, ttl: ttl, now: time.Now, dummyHash: password.Hash("dummy-password-for-timing"), slots: make(chan struct{}, 2)}
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_]{3,24}$`)

func NormalizeUsername(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
func validateCredentials(username, value string) error {
	if !usernamePattern.MatchString(username) {
		return fmt.Errorf("%w: 用户名需为 3～24 位字母、数字或下划线", domain.ErrValidation)
	}
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) < 8 || len(value) > 128 {
		return fmt.Errorf("%w: 密码至少 8 个字符，最多 128 字节", domain.ErrValidation)
	}
	return nil
}
func randomToken() string {
	data := make([]byte, 32)
	_, _ = rand.Read(data)
	return base64.RawURLEncoding.EncodeToString(data)
}
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func (s *AuthService) session(user domain.User) (Authentication, domain.Session) {
	now := s.now().UTC()
	token := randomToken()
	expires := now.Add(s.ttl)
	return Authentication{User: user, Token: token, ExpiresAt: expires}, domain.Session{TokenHash: tokenHash(token), UserID: user.ID, CreatedAt: now.Unix(), ExpiresAt: expires.Unix()}
}
func (s *AuthService) Authenticate(ctx context.Context, username, value, oldToken string, register bool) (Authentication, error) {
	username = NormalizeUsername(username)
	if err := validateCredentials(username, value); err != nil {
		return Authentication{}, err
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return Authentication{}, domain.ErrAuthBusy
	}
	if err := ctx.Err(); err != nil {
		return Authentication{}, err
	}
	if register {
		now := s.now().UTC().Format(time.RFC3339Nano)
		account := domain.Account{User: domain.User{ID: randomToken(), Username: username, DisplayName: username, CreatedAt: now, LastLoginAt: now}, PasswordHash: password.Hash(value)}
		result, session := s.session(account.User)
		err := s.repository.Create(ctx, account, session, tokenHash(oldToken))
		return result, err
	}
	account, err := s.repository.Find(ctx, username)
	if err != nil && !errors.Is(err, domain.ErrCredentials) {
		return Authentication{}, err
	}
	hash := account.PasswordHash
	if errors.Is(err, domain.ErrCredentials) {
		hash = s.dummyHash
	}
	matched, verifyErr := password.Verify(value, hash)
	if verifyErr != nil {
		return Authentication{}, verifyErr
	}
	if !matched || err != nil {
		return Authentication{}, domain.ErrCredentials
	}
	account.LastLoginAt = s.now().UTC().Format(time.RFC3339Nano)
	result, session := s.session(account.User)
	err = s.repository.Login(ctx, account.User, session, tokenHash(oldToken))
	return result, err
}
func (s *AuthService) Current(ctx context.Context, token string) (domain.User, error) {
	if len(token) != 43 {
		return domain.User{}, domain.ErrUnauthenticated
	}
	return s.repository.Current(ctx, tokenHash(token), s.now().Unix())
}
func (s *AuthService) UpdateProfile(ctx context.Context, token, name string) (domain.User, error) {
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) || utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 32 {
		return domain.User{}, fmt.Errorf("%w: 昵称需为 1～32 个字符", domain.ErrValidation)
	}
	for _, c := range name {
		if unicode.IsControl(c) {
			return domain.User{}, fmt.Errorf("%w: 昵称不能包含控制字符", domain.ErrValidation)
		}
	}
	if len(token) != 43 {
		return domain.User{}, domain.ErrUnauthenticated
	}
	return s.repository.UpdateProfile(ctx, tokenHash(token), s.now().Unix(), name)
}
func (s *AuthService) Logout(ctx context.Context, token string) error {
	return s.repository.Logout(ctx, tokenHash(token))
}
