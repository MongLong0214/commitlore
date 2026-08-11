# CDEB evaluator image (PRD §12.1).
#
# The base image is pinned by DIGEST at build time: resolve
# `node:22-alpine` with `docker manifest inspect`, substitute the digest on
# the FROM line, and record both in the freeze manifest. A tag-only FROM is
# a protocol violation — the freeze gate refuses it (CDEB-11).
#
# The engine is copied from the pinned build context (runner-oci.ts's
# ENGINE_CONTEXT_FILES, verified against evaluatorImageContextDigest()).
# Nothing from the candidate tree ever enters this image, and the candidate
# tree never enters this image at build time either: it is bind-mounted
# read-only at /input at run time, by runner-oci.ts.
#
# Trust model inside the container: the entrypoint runs privileged (root
# user of a caps-dropped, read-only, network-less container) because every
# probe it spawns DROPS to uid/gid 65534 (probe.ts). /cdeb is root-owned and
# unreadable by anyone else, so candidate code executing in a probe cannot
# read the engine sources or the sealed task module — §12.3's hidden-path
# prohibition, enforced by file modes instead of by hoping.
#
# No package manager runs here: the engine has zero dependencies beyond the
# node runtime itself, which is exactly why — an `npm install` at image
# build would be a network fetch whose contents the pin must then vouch for.
FROM node:22-alpine

ENV TZ=UTC LC_ALL=C LANG=C NODE_OPTIONS= HOME=/tmp

WORKDIR /cdeb
COPY engine/ /cdeb/engine/
COPY cdeb-evaluate.sh /cdeb/evaluate
RUN chmod 0555 /cdeb/evaluate \
    && chmod -R go-rwx /cdeb \
    && chmod -R a-w /cdeb

ENTRYPOINT ["/cdeb/evaluate"]
