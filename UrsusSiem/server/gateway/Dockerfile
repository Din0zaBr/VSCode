FROM golang:1.22-bookworm AS builder

WORKDIR /app
COPY go.mod go.sum* ./
# Resolve transitive deps and create go.sum on first build (cached afterwards).
RUN go mod download && go mod tidy

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o logvault-go ./main.go

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/logvault-go /app/logvault-go
ENV ADDR=:8080
EXPOSE 8080
CMD ["/app/logvault-go"]
