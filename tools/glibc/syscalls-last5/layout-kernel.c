#include <asm/siginfo.h>
#include <linux/mount.h>
#include <linux/capability.h>
#define O(t,f) __builtin_offsetof(t,f)
const unsigned last5_layout[]={sizeof(struct __user_cap_header_struct),_Alignof(struct __user_cap_header_struct),O(struct __user_cap_header_struct,version),O(struct __user_cap_header_struct,pid),sizeof(struct __user_cap_data_struct),_Alignof(struct __user_cap_data_struct),O(struct __user_cap_data_struct,effective),O(struct __user_cap_data_struct,permitted),O(struct __user_cap_data_struct,inheritable),sizeof(struct mount_attr),_Alignof(struct mount_attr),O(struct mount_attr,attr_set),O(struct mount_attr,attr_clr),O(struct mount_attr,propagation),O(struct mount_attr,userns_fd),sizeof(siginfo_t),_Alignof(siginfo_t),O(siginfo_t,si_signo),O(siginfo_t,si_errno),O(siginfo_t,si_code),O(siginfo_t,si_pid),O(siginfo_t,si_uid),O(siginfo_t,si_value),sizeof(((siginfo_t*)0)->si_value),SI_USER,(unsigned)SI_QUEUE,(unsigned)SI_TKILL};
