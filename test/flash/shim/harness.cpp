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
 */
#include <cstdio>
#include <fstream>
#include <string>

#include "Arduino.h"

// The sketch under test, supplied with `-I <its directory>`.
#include "sketch.ino"

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

  setup();
  std::string line;
  while (std::getline(commands, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    Serial.feedLine(line);
    for (int pump = 0; pump < 4; pump += 1) loop();
  }
  for (int pump = 0; pump < 4; pump += 1) loop();

  const std::string output = Serial.takeOutput();
  std::fwrite(output.data(), 1, output.size(), stdout);
  return 0;
}
