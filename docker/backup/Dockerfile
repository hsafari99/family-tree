# Backups and restores (spec §8, decision 14): pg_dump/pg_restore 17, age and rclone (Go, no AVX2).
FROM postgres:17.11-alpine
RUN apk add --no-cache age rclone
COPY docker/backup/backup.sh docker/backup/restore.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh
USER postgres
WORKDIR /tmp
ENTRYPOINT []
CMD ["backup.sh"]
