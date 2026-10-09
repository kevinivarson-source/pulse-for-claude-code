#!/usr/bin/env bash
# Pulse logger for Claude Code. One tiny line per Claude Code event:
#   saved locally in ~/.claude/pulse/<date>-<session>.pulse (backup, works offline)
#   and sent to your Pulse player in the background (never slows Claude down).
# Line format: <epoch-ms> <code> [tool]
# Codes: S start, U prompt, T tool start, D tool done, A subagent done,
#        E turn end, N waiting for you, C context compaction, Q session end
code="$1"
dir="$HOME/.claude/pulse"
mkdir -p "$dir" 2>/dev/null || exit 0
input=$(cat)
field() { printf '%s' "$input" | grep -o "\"$1\" *: *\"[^\"]*\"" | head -1 | sed 's/.*"\([^"]*\)"$/\1/'; }
sid=$(field session_id); sid=${sid:0:8}; [ -z "$sid" ] && sid=nosession
tool=""; case "$code" in T|D) tool=$(field tool_name) ;; esac

file=$(ls "$dir"/*-"$sid".pulse 2>/dev/null | head -1)
if [ -z "$file" ]; then
  # Two hooks can fire at the same instant (for example start and a subagent). A short lock lets
  # only one of them create the file, and the file appears whole, so no line is ever wiped.
  lock="$dir/.$sid.lock"; i=0
  until mkdir "$lock" 2>/dev/null; do i=$((i + 1)); [ "$i" -ge 20 ] && break; sleep 0.05; done
  file=$(ls "$dir"/*-"$sid".pulse 2>/dev/null | head -1)
  if [ -z "$file" ]; then
    proj=$(field cwd); proj=${proj//\\\\//}; proj=${proj//\\//}; proj=${proj%/}; proj=${proj##*/}
    proj=${proj//[^A-Za-z0-9._-]/-}
    file="$dir/$(date +%Y%m%d-%H%M)-$sid.pulse"
    echo "$(date +%Y-%m-%dT%H:%M) ${proj:-session}" > "$file.new$$" && mv "$file.new$$" "$file"
  fi
  rmdir "$lock" 2>/dev/null
fi
ms=$(date +%s%3N 2>/dev/null)
case "$ms" in *N*|"") ms="$(date +%s)000" ;; esac
if [ -n "$tool" ]; then echo "$ms $code $tool" >> "$file"; else echo "$ms $code" >> "$file"; fi

# Cloud upload: sends every line not yet confirmed. Retries are safe; the cloud ignores repeats.
# Your player's address and key live in ~/.claude/pulse/cloud (two lines: PULSE_URL=… and PULSE_KEY=…).
cfg="$dir/cloud"; [ -f "$cfg" ] || cfg="$(dirname "$0")/cloud"
[ -f "$cfg" ] || exit 0
(
  . "$cfg"
  sent="$file.sent"
  n=$(cat "$sent" 2>/dev/null); n=${n:-1}
  total=$(wc -l < "$file" | tr -d ' ')
  [ "$total" -gt "$n" ] || exit 0
  proj=$(head -1 "$file" | cut -d' ' -f2-)
  { echo "S $sid $proj"; tail -n +"$((n + 1))" "$file"; } |
    curl -sf -m 10 -X POST -H "Authorization: Bearer $PULSE_KEY" -H "Content-Type: text/plain" \
      --data-binary @- "$PULSE_URL/api/ingest" >/dev/null && echo "$total" > "$sent"
) </dev/null >/dev/null 2>&1 &
exit 0
