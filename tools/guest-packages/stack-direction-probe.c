#include <stdint.h>
#include <stdio.h>
_Static_assert(sizeof(void *) == 4, "wasm32 probe required");
__attribute__((noinline)) static int direction(uintptr_t outer, int depth) {
    volatile int current = depth;
    int result = depth ? direction(outer, depth - 1) : (((uintptr_t)&current < outer) ? -1 : 1);
    return result + (current == -12345); /* Keep the frame live after recursion. */
}
int main(void) {
    volatile int outer = 7;
    int result = direction((uintptr_t)&outer, 3);
    printf("GNU_STACK_DIRECTION=%d\n", result);
    return result == -1 ? 0 : 1;
}
