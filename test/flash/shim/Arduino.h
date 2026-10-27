#ifndef TC_ARDUINO_SHIM_H
#define TC_ARDUINO_SHIM_H

/**
 * Just enough Arduino to run a generated sketch on the host.
 *
 * The point of this file is the equivalence test in `test/flash/host.test.ts`:
 * the same sketch text that `arduino-cli` compiles for an Uno is also compiled
 * with g++ here and driven through a command script, so the firmware's settle,
 * clock-edge and connector behaviour is compared with `Simulation` before a
 * board is ever plugged in. It is NOT an Arduino emulator -- `millis()` is 0 and
 * `Serial` is a queue -- because the tests drive every clock edge explicitly and
 * the firmware's free-run mode is not what needs proving.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <deque>
#include <string>

#define HEX 16
#define DEC 10
#define PROGMEM
#define F(text) (text)
#define pgm_read_byte(address) (*(const uint8_t *)(address))
#define pgm_read_word(address) (*(const uint16_t *)(address))
#define memcpy_P memcpy

/** The Arduino pin vocabulary a generated sketch is allowed to use. */
#define LOW 0x0
#define HIGH 0x1
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2

/**
 * The pin state a real board would have, as far as a host test needs it.
 *
 * A downloaded pin is driven by the sketch (`digitalWrite` records what it did,
 * so the test can assert the mapping). An input pin reads what the harness drives
 * (`tcShimSetRead`); with nothing driving it and `INPUT_PULLUP` set it reads HIGH,
 * exactly like the board, which is what makes a mapped-but-unwired input
 * deterministic in a test.
 */
inline uint8_t tcShimPinMode[70];
inline uint8_t tcShimPinWritten[70];
inline uint8_t tcShimPinRead[70];
inline uint8_t tcShimPinDriven[70];

inline void pinMode(uint8_t pin, uint8_t mode) {
  if (pin < 70) tcShimPinMode[pin] = mode;
}
inline void digitalWrite(uint8_t pin, uint8_t value) {
  if (pin < 70) tcShimPinWritten[pin] = value == HIGH ? 1 : 0;
}
inline int digitalRead(uint8_t pin) {
  if (pin >= 70) return LOW;
  if (tcShimPinDriven[pin]) return tcShimPinRead[pin] ? HIGH : LOW;
  return tcShimPinMode[pin] == INPUT_PULLUP ? HIGH : LOW;
}
/** The harness's side: what an external wire holds this input pin at. */
inline void tcShimSetRead(uint8_t pin, uint8_t value) {
  if (pin >= 70) return;
  tcShimPinDriven[pin] = 1;
  tcShimPinRead[pin] = value ? 1 : 0;
}

inline unsigned long millis(void) {
  return 0UL;
}

inline void delay(unsigned long) {}

/** A serial port backed by a deque in and a string out. */
class TcSerialShim {
 public:
  void begin(long) {}
  int available() {
    return static_cast<int>(input_.size());
  }
  int read() {
    if (input_.empty()) return -1;
    const char value = input_.front();
    input_.pop_front();
    return static_cast<int>(static_cast<unsigned char>(value));
  }
  void print(const char *text) {
    output_ += text;
  }
  void print(char value) {
    output_ += value;
  }
  void print(int value) {
    char buffer[24];
    snprintf(buffer, sizeof buffer, "%d", value);
    output_ += buffer;
  }
  void print(unsigned int value) {
    char buffer[24];
    snprintf(buffer, sizeof buffer, "%u", value);
    output_ += buffer;
  }
  void print(long value) {
    char buffer[24];
    snprintf(buffer, sizeof buffer, "%ld", value);
    output_ += buffer;
  }
  void print(unsigned long value) {
    char buffer[24];
    snprintf(buffer, sizeof buffer, "%lu", value);
    output_ += buffer;
  }
  void print(unsigned int value, int base) {
    char buffer[40];
    snprintf(buffer, sizeof buffer, base == HEX ? "%X" : "%u", value);
    output_ += buffer;
  }
  void print(unsigned long value, int base) {
    char buffer[40];
    snprintf(buffer, sizeof buffer, base == HEX ? "%lX" : "%lu", value);
    output_ += buffer;
  }
  void println() {
    output_ += '\n';
  }
  void println(const char *text) {
    output_ += text;
    output_ += '\n';
  }
  void println(int value) {
    print(value);
    output_ += '\n';
  }

  /** The harness's side: one command line, newline included. */
  void feedLine(const std::string &line) {
    for (const char value : line) input_.push_back(value);
    input_.push_back('\n');
  }
  std::string takeOutput() {
    std::string taken;
    taken.swap(output_);
    return taken;
  }

 private:
  std::string output_;
  std::deque<char> input_;
};

inline TcSerialShim Serial;

#endif
