#ifndef SXSY_B122_PROTOCOL_H
#define SXSY_B122_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define B122_FRAME_SIZE 32u
#define B122_MAX_PENDING 8u

enum b122_message_type { B122_HELLO = 1, B122_HELLO_ACK = 2, B122_SIGNAL = 3, B122_ACK = 4, B122_NACK = 5, B122_STATUS = 6 };
enum b122_ack_status { B122_ACK_ACCEPTED = 0, B122_ACK_DUPLICATE = 1 };
enum b122_device_status { B122_STATUS_BOOTING = 0, B122_STATUS_READY = 1, B122_STATUS_BUSY = 2, B122_STATUS_DEGRADED = 3 };

typedef struct {
    uint8_t bytes[B122_FRAME_SIZE];
    uint32_t sent_at_ms;
    uint8_t retries;
    bool occupied;
} b122_pending_frame_t;

typedef struct {
    uint32_t connection_epoch;
    uint32_t boot_nonce;
    uint32_t device_counter;
    uint32_t host_counter;
    uint32_t last_acknowledged_counter;
    bool handshake_complete;
    bool degraded;
    b122_pending_frame_t pending[B122_MAX_PENDING];
} b122_device_protocol_t;

uint32_t b122_crc32(const uint8_t *bytes, size_t length);
bool b122_frame_valid(const uint8_t frame[B122_FRAME_SIZE]);
uint32_t b122_frame_counter(const uint8_t frame[B122_FRAME_SIZE]);
uint8_t b122_frame_type(const uint8_t frame[B122_FRAME_SIZE]);

void b122_device_init(b122_device_protocol_t *state, uint32_t epoch, uint32_t boot_nonce);
bool b122_device_hello(b122_device_protocol_t *state, uint32_t now_ms, uint8_t out[B122_FRAME_SIZE]);
bool b122_device_signal(b122_device_protocol_t *state, uint8_t control_id, uint8_t modifier_mask, uint32_t now_ms, uint8_t out[B122_FRAME_SIZE]);
bool b122_device_status(b122_device_protocol_t *state, enum b122_device_status status, uint32_t now_ms, uint8_t out[B122_FRAME_SIZE]);
bool b122_device_receive(b122_device_protocol_t *state, const uint8_t frame[B122_FRAME_SIZE]);
size_t b122_device_retries(b122_device_protocol_t *state, uint32_t now_ms, uint32_t retry_after_ms, uint8_t max_retries, uint8_t (*out)[B122_FRAME_SIZE], size_t capacity);
bool b122_device_has_pending(const b122_device_protocol_t *state);
bool b122_device_take_degraded(b122_device_protocol_t *state);

#endif
