/**
 * Drives one generated sketch through a command script on the host.
 *
 * Usage: harness <commands-file>
 *
 * `setup()` runs first; then each line drives the standalone sketch. `=` sets an
 * input pin to a level, `T` advances one clock edge, `R` resets, `S` prints a
 * snapshot of every output pin, and any other line is fed to the serial queue
 * (kept only so old scripts fail loudly rather than silently doing nothing).
 *
 * PIN CHANGES are also reported as `PIN <pin> <value>` lines, one per output pin
 * the sketch drives to a new level, so a test can assert the physical side of a
 * mapping.
 */
#include <cstdio>
#include <fstream>
#include <string>

#include "Arduino.h"

// The sketch under test, supplied with `-I <its directory>`.
#include "sketch.ino"

namespace {

/** Report every pin the sketch drove to a level different from the last report. */
void reportPinChanges(std::string &log) {
  for (int pin = 0; pin < 70; pin += 1) {
    static uint8_t reported[70];
    if (tcShimPinWritten[pin] == reported[pin]) continue;
    reported[pin] = tcShimPinWritten[pin];
    char line[32];
    std::snprintf(line, sizeof line, "PIN %d %d\n", pin, reported[pin]);
    log += line;
  }
}

/** Snapshot every pin the sketch configured as an output: `SNAP 13=1 12=0`. */
void snapshot(std::string &log) {
  log += "SNAP";
  for (int pin = 0; pin < 70; pin += 1) {
    if (tcShimPinMode[pin] != OUTPUT) continue;
    char line[24];
    std::snprintf(line, sizeof line, " %d=%d", pin, tcShimPinWritten[pin]);
    log += line;
  }
  log += '\n';
}

/** Pump an idle loop a few times after a change. */
void pump() {
  for (int count = 0; count < 4; count += 1) loop();
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: harness <commands-file>\n");
    return 2;
  }
  std::ifstream commands(argv[1]);
  if (!commands) {
    std::fprintf(stderr, "cannot open %s\n", argv[1]);
    return 2;
  }

  std::string pins;
  setup();
  reportPinChanges(pins);
  std::string line;
  while (std::getline(commands, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    if (line == "T") {
      // The sketch exposes its clock edge as a file-local function; the harness
      // includes the .ino, so it can advance one edge without a serial command.
      tcTick();
    } else if (line == "R") {
      tcReset();
    } else if (line == "S") {
      snapshot(pins);
    } else if (line[0] == '=') {
      int pin = -1;
      int value = 0;
      if (std::sscanf(line.c_str(), "= %d %d", &pin, &value) == 2) {
        tcShimSetRead(static_cast<uint8_t>(pin), static_cast<uint8_t>(value != 0));
      }
    } else {
      Serial.feedLine(line);
    }
    pump();
    reportPinChanges(pins);
  }
  pump();
  reportPinChanges(pins);

  const std::string output = Serial.takeOutput();
  std::fwrite(pins.data(), 1, pins.size(), stdout);
  std::fwrite(output.data(), 1, output.size(), stdout);
  return 0;
}
