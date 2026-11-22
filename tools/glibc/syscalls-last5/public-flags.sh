# Applied after genuine GNU flags; public client avoids libc internal headers.
public_flags=()
for ((idx=0;idx<${#flags[@]};idx++)); do
 item=${flags[idx]}
 if [[ "$item" == -include ]]; then ((idx+=1)); continue; fi
 if [[ "$item" == -DMODULE_NAME=libc || "$item" == -D_LIBC_REENTRANT ]]; then continue; fi
 public_flags+=( "$item" )
done
public_flags+=( -D_ISOMAC=1 -D_GNU_SOURCE=1 )
