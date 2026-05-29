FROM scratch

ARG TARGETARCH

COPY ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

COPY prod-linux-${TARGETARCH} /prod

ENV NET_HOST=false

ENTRYPOINT ["/prod"]
