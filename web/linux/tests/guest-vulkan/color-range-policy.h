#ifndef GUEST_COLOR_RANGE_POLICY_H
#define GUEST_COLOR_RANGE_POLICY_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>
/* Bounded JSON syntax recognizer. New capabilities accept only unescaped
 * top-level keys and exact unsigned decimal literals; JSON whitespace is
 * accepted. Duplicate new top-level fields fail. Nested fields never enable
 * the profile. Existing historical profile parsing remains unchanged. */
struct color_json { const char *s; size_t n,p; };
static void color_json_ws(struct color_json *j) {
    while(j->p<j->n && (j->s[j->p]==' '||j->s[j->p]=='\t'||j->s[j->p]=='\r'||j->s[j->p]=='\n'))j->p++;
}
static int color_json_digit(char c) { return c>='0'&&c<='9'; }
static int color_json_hex(char c) {return color_json_digit(c)||(c>='a'&&c<='f')||(c>='A'&&c<='F');}
static int color_json_string(struct color_json *j,size_t *start,size_t *length,int *escaped) {
    if(j->p>=j->n||j->s[j->p++]!='"')return 0;
    *start=j->p;*escaped=0;
    while(j->p<j->n) {
        unsigned char c=(unsigned char)j->s[j->p++];
        if(c=='"'){*length=j->p-1-*start;return 1;}
        if(c<32)return 0;
        if(c=='\\') {
            *escaped=1;if(j->p>=j->n)return 0;c=(unsigned char)j->s[j->p++];
            if(c=='u'){for(unsigned i=0;i<4;i++)if(j->p>=j->n||!color_json_hex(j->s[j->p++]))return 0;}
            else if(!strchr("\"\\/bfnrt",c))return 0;
        }
    }
    return 0;
}
static int color_json_number(struct color_json *j) {
    if(j->p<j->n&&j->s[j->p]=='-')j->p++;
    if(j->p>=j->n)return 0;
    if(j->s[j->p]=='0')j->p++;
    else {if(j->s[j->p]<'1'||j->s[j->p]>'9')return 0;do{j->p++;}while(j->p<j->n&&color_json_digit(j->s[j->p]));}
    if(j->p<j->n&&j->s[j->p]=='.'){j->p++;if(j->p>=j->n||!color_json_digit(j->s[j->p]))return 0;do{j->p++;}while(j->p<j->n&&color_json_digit(j->s[j->p]));}
    if(j->p<j->n&&(j->s[j->p]=='e'||j->s[j->p]=='E')){j->p++;if(j->p<j->n&&(j->s[j->p]=='+'||j->s[j->p]=='-'))j->p++;if(j->p>=j->n||!color_json_digit(j->s[j->p]))return 0;do{j->p++;}while(j->p<j->n&&color_json_digit(j->s[j->p]));}
    return 1;
}
static int color_json_value(struct color_json *j,unsigned depth) {
    if(depth>16)return 0;
    color_json_ws(j);if(j->p>=j->n)return 0;
    char c=j->s[j->p];
    if(c=='"'){size_t start,length;int escaped;return color_json_string(j,&start,&length,&escaped);}
    if(c=='{'||c=='[') {
        char end=c=='{'?'}':']';j->p++;color_json_ws(j);
        if(j->p<j->n&&j->s[j->p]==end){j->p++;return 1;}
        for(;;) {
            if(c=='{'){size_t start,length;int escaped;if(!color_json_string(j,&start,&length,&escaped))return 0;color_json_ws(j);if(j->p>=j->n||j->s[j->p++]!=':')return 0;}
            if(!color_json_value(j,depth+1))return 0;
            color_json_ws(j);if(j->p>=j->n)return 0;
            char next=j->s[j->p++];if(next==end)return 1;if(next!=',')return 0;color_json_ws(j);
        }
    }
    const char *literal=c=='t'?"true":c=='f'?"false":c=='n'?"null":NULL;
    if(literal){size_t n=strlen(literal);if(n>j->n-j->p||memcmp(j->s+j->p,literal,n))return 0;j->p+=n;return 1;}
    return color_json_number(j);
}
static int color_large_profile(const char *s,size_t n) {
    if(!s||!n||n>4095||memchr(s,0,n))return 0;
    struct color_json j={s,n,0};unsigned seen=0;int matched=1;color_json_ws(&j);
    if(j.p>=n||s[j.p++]!='{')return 0;
    color_json_ws(&j);
    if(j.p<n&&s[j.p]=='}')return 0;
    for(;;) {
        size_t start,length;int escaped;if(!color_json_string(&j,&start,&length,&escaped)||escaped)return 0;
        static const char *keys[]={"colorTargetRangeProfile","maxColorTargetDimension","maxColorTargetBytes","maxReadbackRangeBytes"};
        static const char *values[]={"1","512","1048576","65516"};int field=-1;
        for(unsigned k=0;k<4;k++)if(length==strlen(keys[k])&&!memcmp(s+start,keys[k],length))field=(int)k;
        color_json_ws(&j);if(j.p>=n||s[j.p++]!=':')return 0;color_json_ws(&j);size_t value_start=j.p;
        if(!color_json_value(&j,0))return 0;
        size_t value_length=j.p-value_start;
        if(field>=0){unsigned bit=1u<<(unsigned)field;if(seen&bit)return 0;seen|=bit;size_t expected=strlen(values[field]);if(value_length!=expected||memcmp(s+value_start,values[field],expected))matched=0;}
        color_json_ws(&j);if(j.p>=n)return 0;char next=s[j.p++];if(next=='}')break;if(next!=',')return 0;color_json_ws(&j);
    }
    color_json_ws(&j);return j.p==n&&seen==15&&matched;
}
static int sampled_color_profile(const char *s,size_t n) {
    if(!s||!n||n>4095||memchr(s,0,n))return 0;
    struct color_json j={s,n,0};unsigned seen=0;int matched=1;color_json_ws(&j);
    if(j.p>=n||s[j.p++]!='{')return 0;
    color_json_ws(&j);
    if(j.p<n&&s[j.p]=='}')return 0;
    for(;;) {
        size_t start,length;int escaped;if(!color_json_string(&j,&start,&length,&escaped)||escaped)return 0;
        static const char *keys[]={"sampledColorTargetProfile","maxSampledColorTargetDimension","maxSampledColorTargetBytes","maxSampledColorTargetBindings"};
        static const char *values[]={"1","512","1048576","4"};int field=-1;
        for(unsigned k=0;k<4;k++)if(length==strlen(keys[k])&&!memcmp(s+start,keys[k],length))field=(int)k;
        color_json_ws(&j);if(j.p>=n||s[j.p++]!=':')return 0;color_json_ws(&j);size_t value_start=j.p;
        if(!color_json_value(&j,0))return 0;
        size_t value_length=j.p-value_start;
        if(field>=0){unsigned bit=1u<<(unsigned)field;if(seen&bit)return 0;seen|=bit;size_t expected=strlen(values[field]);if(value_length!=expected||memcmp(s+value_start,values[field],expected))matched=0;}
        color_json_ws(&j);if(j.p>=n)return 0;char next=s[j.p++];if(next=='}')break;if(next!=',')return 0;color_json_ws(&j);
    }
    color_json_ws(&j);return j.p==n&&seen==15&&matched;
}
static int depth_stencil_profile(const char *s,size_t n) {
    if(!s||!n||n>4095||memchr(s,0,n))return 0;
    struct color_json j={s,n,0};unsigned seen=0;int matched=1;color_json_ws(&j);
    if(j.p>=n||s[j.p++]!='{')return 0;
    color_json_ws(&j);
    if(j.p<n&&s[j.p]=='}')return 0;
    for(;;) {
        size_t start,length;int escaped;if(!color_json_string(&j,&start,&length,&escaped)||escaped)return 0;
        static const char *keys[]={"depthStencilProfile","maxDepthStencilDimension","minimumDepthBits","stencilBits"};
        static const char *values[]={"2","512","24","8"};int field=-1;
        for(unsigned k=0;k<4;k++)if(length==strlen(keys[k])&&!memcmp(s+start,keys[k],length))field=(int)k;
        color_json_ws(&j);if(j.p>=n||s[j.p++]!=':')return 0;color_json_ws(&j);size_t value_start=j.p;
        if(!color_json_value(&j,0))return 0;
        size_t value_length=j.p-value_start;
        if(field>=0){unsigned bit=1u<<(unsigned)field;if(seen&bit)return 0;seen|=bit;size_t expected=strlen(values[field]);if(value_length!=expected||memcmp(s+value_start,values[field],expected))matched=0;}
        color_json_ws(&j);if(j.p>=n)return 0;char next=s[j.p++];if(next=='}')break;if(next!=',')return 0;color_json_ws(&j);
    }
    color_json_ws(&j);return j.p==n&&seen==15&&matched;
}
/* Subtraction before multiplication/addition prevents UINT64 wrap and proves
 * every destination row ends inside the buffer before command recording. */
static inline int color_copy_region_fits(uint64_t size,uint64_t offset,uint64_t row,uint64_t width_bytes,uint64_t height) {
    if(!height||!width_bytes||offset>size||width_bytes>size-offset)return 0;
    return height==1||row<=(size-offset-width_bytes)/(height-1);
}
#endif
