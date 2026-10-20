package main

import (
	"bakafactory/server/internal/application"
	"bakafactory/server/internal/catalog"
	"bakafactory/server/internal/config"
	"bakafactory/server/internal/database"
	"bakafactory/server/internal/httpapi"
	"bakafactory/server/internal/repository"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: c.LogLevel}))
	slog.SetDefault(logger)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	db, err := database.Open(startup, c.DatabasePath)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := database.Migrate(startup, db); err != nil {
		return err
	}
	service := application.NewHealthService(repository.NewHealth(db), c.Version, c.Environment)
	auth := application.NewAuthService(repository.NewAccounts(db), c.SessionTTL)
	definitions, err := catalog.Load()
	if err != nil {
		return err
	}
	saves := application.NewSaveService(repository.NewSaves(db), auth, definitions)
	handler, err := httpapi.New(service, logger, c.WebDir, httpapi.AuthOptions{Service: auth, Secure: c.Environment == "production", TTL: c.SessionTTL, Origins: c.Origins, Saves: saves})
	if err != nil {
		return err
	}
	server := &http.Server{Addr: c.Address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	logger.Info("server starting", "address", c.Address, "environment", c.Environment, "version", c.Version, "database", c.DatabasePath)
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		logger.Info("server shutting down")
		if err := server.Shutdown(shutdown); err != nil {
			_ = server.Close()
			return err
		}
		return nil
	}
}
