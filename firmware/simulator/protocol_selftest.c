#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "../protocol/b122_protocol.h"

static void write_u32(unsigned char *bytes, unsigned long value) {
    bytes[0] = (unsigned char)value; bytes[1] = (unsigned char)(value >> 8); bytes[2] = (unsigned char)(value >> 16); bytes[3] = (unsigned char)(value >> 24);
}

static void host_frame(unsigned char type, unsigned long epoch, unsigned long counter, unsigned long nonce, unsigned char out[B122_FRAME_SIZE]) {
    memset(out, 0, B122_FRAME_SIZE); out[0] = 0xB1; out[1] = 0x22; out[2] = 1; out[3] = type; out[5] = 12;
    write_u32(&out[8], epoch); write_u32(&out[12], counter); write_u32(&out[16], nonce);
}

int main(void) {
    b122_device_protocol_t device;
    unsigned char hello[B122_FRAME_SIZE], response[B122_FRAME_SIZE], signal[B122_FRAME_SIZE], retries[1][B122_FRAME_SIZE];
    b122_device_init(&device, 7u, 11u);
    assert(b122_device_hello(&device, 0u, hello));
    assert(b122_frame_valid(hello));
    hello[6] = 1u; write_u32(&hello[28], b122_crc32(hello, 28u)); assert(!b122_frame_valid(hello)); hello[6] = 0u; write_u32(&hello[28], b122_crc32(hello, 28u));
    assert(!b122_device_signal(&device, 1u, 0u, 0u, signal));
    host_frame(B122_HELLO_ACK, 7u, 1u, 11u, response); memcpy(&response[20], &hello[20], 8u); write_u32(&response[28], b122_crc32(response, 28u));
    assert(b122_device_receive(&device, response));
    assert(!b122_device_receive(&device, response)); /* Host counter replay. */
    assert(b122_device_signal(&device, 1u, 4u, 10u, signal));
    assert(signal[22] == 0u); /* Intentionally unassigned Ctrl chord is still only a signal. */
    assert(b122_device_retries(&device, 300u, 250u, 3u, retries, 1u) == 1u);
    assert(memcmp(signal, retries[0], B122_FRAME_SIZE) == 0);
    assert(b122_device_retries(&device, 600u, 250u, 3u, retries, 1u) == 1u);
    assert(b122_device_retries(&device, 900u, 250u, 3u, retries, 1u) == 1u);
    assert(b122_device_retries(&device, 1200u, 250u, 3u, retries, 1u) == 0u);
    assert(b122_device_take_degraded(&device));
    assert(!b122_device_take_degraded(&device));
    host_frame(B122_ACK, 7u, 2u, 11u, response); response[24] = 9u; write_u32(&response[28], b122_crc32(response, 28u));
    assert(!b122_frame_valid(response));
    puts("B122 C protocol self-test passed");
    return 0;
}
