#!/usr/bin/env python3
"""Packet identities a judge cannot reverse into an arm.

The first version hashed the candidate id and the arm with a salt committed
beside the code, and called the result opaque. It was not: seventeen candidates
times two arms is thirty-four combinations, and a hostile review pointed out that
the whole mapping falls out of thirty-four hashes. Measured, the reversal takes
under a millisecond.

Opacity here needs a secret, not a separator. The salt is generated once with
`secrets`, written outside the repository, and never committed while judging is
open. Packet ids are HMAC over that salt, so without it there is nothing to
enumerate.

What *is* committed before judging starts is a commitment: the digest of the
mapping file. Publishing the salt and the mapping after section 21.4's seal lets
anyone recompute both and see the assignment was fixed in advance rather than
chosen to fit the answers. Concealment before, verifiability after -- a mapping
revealed early proves nothing, and one that can never be checked proves nothing
either.
"""
import hashlib
import hmac
import json
import os
import secrets

# Deliberately outside the repository: committing this file while judging is open
# would undo the whole point, and a path inside the tree invites exactly that.
DEFAULT_SECRET_PATH = os.path.expanduser(
    "~/.commitlore-cdeb/v8-packet-salt.json")


def load_or_create_salt(path=DEFAULT_SECRET_PATH):
    """Read the salt, or mint one. Never regenerate over an existing salt."""
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)["salt"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    salt = secrets.token_hex(32)
    # 0o600 and a fresh file: a salt other processes can read is not a secret.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump({"salt": salt,
                   "what_this_is":
                       "The secret that makes v8 judge packet ids unreversible. "
                       "Publish it only after section 21.4's seal: coding rows "
                       "sealed AND 1,020 judgements sealed.",
                   "never_commit_while_judging_is_open": True}, fh, indent=2)
    return salt


def packet_id(salt, candidate_id, arm, repetition):
    """HMAC, not a plain hash: the salt is the key, so it cannot be brute-forced."""
    message = f"{candidate_id}|{arm}|{repetition}".encode()
    return hmac.new(bytes.fromhex(salt), message, hashlib.sha256).hexdigest()[:24]


def build_mapping(salt, episodes):
    """packet id -> the assignment it stands for, for every scheduled episode."""
    mapping = {}
    for episode in episodes:
        pid = packet_id(salt, episode["candidate_id"], episode["arm"],
                        episode["repetition"])
        if pid in mapping:
            raise SystemExit(f"packet id collision on {pid}")
        mapping[pid] = {
            "candidate_id": episode["candidate_id"],
            "arm": episode["arm"],
            "repetition": episode["repetition"],
            "episode_index": episode["episode_index"],
        }
    return mapping


def commitment(mapping):
    """A digest of the mapping, committable while the mapping itself is withheld."""
    canonical = json.dumps(mapping, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def reversal_cost(salt_known):
    """What an attacker faces, stated as the thing that changed.

    With the old committed salt the answer was 34 hashes. With an unknown
    256-bit key it is a search over the key, which is what "opaque" has to mean
    if the word is doing any work.
    """
    return ("34 hashes" if salt_known
            else "a search over a 256-bit key, not over 34 candidate/arm pairs")
