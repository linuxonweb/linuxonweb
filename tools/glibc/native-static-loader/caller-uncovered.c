/* Deliberately separately linked non-NULL target outside compiler coverage. */
static unsigned entered;
int uncovered_nonnull(void) {entered++;return 4093;}
unsigned uncovered_entered(void) {return entered;}
