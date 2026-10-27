/**
 * Drives one generated sketch through a command script on the host.
 *
 * Usage: harness <commands-file>
 *
 * `setup()` runs first, so the banner and the initial frame are part of the
 * output; then each line is fed to the sketch's serial queue and `loop()` is
 * pumped. Four pumps per line is plenty because `loop()` drains the whole queue
 * in one call, and the extra calls prove that an idle loop does not tick by
 * itself.
 *
 * TWO KINDS OF LINE. A plain line is a serial command (`B`, `I 0 1`, …). A line
 * beginning with `=` is a pin instead: `= <arduino-pin> <0|1>` holds an input pin
 * at that level before the pumps, which is how a mapped input connector gets a
 * value from the "outside world".
 *
 * PIN CHANGES are reported as `PIN <pin> <value>` lines, one per output pin the
 * sketch drives to a new level, so a test can assert the physical side of a
 * mapping as well as the serial frames.
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
    if (line[0] == '=') {
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
