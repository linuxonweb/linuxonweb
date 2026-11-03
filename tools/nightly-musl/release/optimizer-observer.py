#!/usr/bin/env python3
"""Bounded read-only /proc observations for one PID/start-bound optimizer."""
from pathlib import Path
import json, os, time, datetime

class OptimizerObserver:
    def __init__(self, output, sample_seconds=5, maximum_rows=400, maximum_bytes=8*1024*1024, milestone_seconds=530, deadline_extended=False):
        self.output=Path(output); self.path=self.output/'optimizer-observations.jsonl'
        self.interval=sample_seconds; self.maximum_rows=maximum_rows; self.maximum_bytes=maximum_bytes
        self.milestone=milestone_seconds; self.milestone_recorded=False; self.deadline_extended=deadline_extended
        self.last_elapsed=None; self.previous=None; self.rows=0; self.bytes=0; self.errors=0; self.disabled=None
        self.clock_ticks=os.sysconf('SC_CLK_TCK'); self.page_bytes=os.sysconf('SC_PAGE_SIZE')
        with self.path.open('x'): pass

    def _text(self, path, unavailable, field):
        try: return Path(path).read_text().strip()
        except (OSError, ValueError) as error:
            unavailable.append({'field':field,'reason':type(error).__name__}); return None

    def _stat(self, path):
        value=Path(path).read_text(); tail=value[value.rfind(')')+2:].split()
        return {'pid':int(value.split(' ',1)[0]),'start':tail[19],'state':tail[0],
                'cpuSeconds':(int(tail[11])+int(tail[12]))/self.clock_ticks,
                'minorFaults':int(tail[7]),'majorFaults':int(tail[9]),
                'rssBytes':int(tail[21])*self.page_bytes,'threadCount':int(tail[17])}

    @staticmethod
    def _same(stat, expected):
        return stat['pid']==expected['pid'] and stat['start']==str(expected['start'])

    @staticmethod
    def _delta(value, previous):
        if value is None or previous is None or value < previous: return None
        return value-previous

    def _cpu(self, proc, unavailable):
        result={'actualAffinity':None,'cgroup':None,'ancestorCpuMax':None,'effectiveCpus':None}
        try: result['actualAffinity']=sorted(os.sched_getaffinity(int(proc.name)))
        except OSError as error: unavailable.append({'field':'actualAffinity','reason':type(error).__name__})
        cg=self._text(proc/'cgroup',unavailable,'cgroup'); result['cgroup']=cg
        if cg is None: return result
        unified=[line[3:] for line in cg.splitlines() if line.startswith('0::')]
        if len(unified)!=1: unavailable.append({'field':'ancestorCpuMax','reason':'no unique unified cgroup'}); return result
        root=Path('/sys/fs/cgroup'); target=(root/unified[0].lstrip('/')).resolve()
        if not target.is_relative_to(root): unavailable.append({'field':'ancestorCpuMax','reason':'cgroup path outside mount'}); return result
        operands=[]; limits=[]; complete=True
        for parent in [target,*target.parents]:
            if not parent.is_relative_to(root): break
            item=parent/'cpu.max'
            if not item.exists():
                if parent!=root: complete=False; unavailable.append({'field':str(item),'reason':'missing'})
                continue
            text=self._text(item,unavailable,str(item)); operands.append({'path':str(item),'value':text})
            if text is None: complete=False; continue
            try:
                quota,period=text.split()
                if quota!='max': limits.append(int(quota)/int(period))
            except (ValueError,ZeroDivisionError): complete=False; unavailable.append({'field':str(item),'reason':'invalid cpu.max'})
        result['ancestorCpuMax']=operands
        if result['actualAffinity'] is not None and complete: result['effectiveCpus']=min([len(result['actualAffinity']),*limits])
        after=self._text(proc/'cgroup',unavailable,'cgroupAfter')
        result['cgroupStableDuringSample']=after==cg
        if after!=cg: result['effectiveCpus']=None; result['cgroupAfter']=after
        return result

    def _collect(self, expected, elapsed):
        unavailable=[]; proc=Path('/proc')/str(expected['pid'])
        row={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'optimizerElapsedSeconds':elapsed,
             'expectedIdentity':expected,'unavailable':unavailable}
        try: stat=self._stat(proc/'stat')
        except (OSError,ValueError,IndexError) as error:
            row.update(identityMatched=False,identityError=type(error).__name__); return row
        row['identityMatched']=self._same(stat,expected)
        if not row['identityMatched']: return row
        row['process']=stat; previous=self.previous
        wall=elapsed-previous['optimizerElapsedSeconds'] if previous else None
        row['sampleWallSeconds']=wall
        for key in ('cpuSeconds','minorFaults','majorFaults'):
            old=previous.get('process',{}).get(key) if previous else None
            stat[key+'Delta']=self._delta(stat[key],old)
        stat['meanCpusSincePrevious']=stat['cpuSecondsDelta']/wall if wall and stat['cpuSecondsDelta'] is not None else None
        io_text=self._text(proc/'io',unavailable,'processIo'); io=None
        if io_text is not None:
            try: io={key:int(value) for key,value in (line.split(':',1) for line in io_text.splitlines())}
            except ValueError: unavailable.append({'field':'processIo','reason':'invalid'}); io=None
        row['io']=io
        old_io=previous.get('io') if previous else None
        row['ioDeltas']={key:self._delta(value,old_io.get(key) if old_io else None) for key,value in io.items()} if io else None
        row['cpuAdmission']=self._cpu(proc,unavailable)
        memory=self._text('/proc/meminfo',unavailable,'hostMemAvailable'); row['hostMemAvailableBytes']=None
        if memory is not None:
            for line in memory.splitlines():
                if line.startswith('MemAvailable:'):
                    try: row['hostMemAvailableBytes']=int(line.split()[1])*1024
                    except (ValueError,IndexError): unavailable.append({'field':'hostMemAvailable','reason':'invalid'})
        threads=[]; old_threads={(x['pid'],x['start']):x for x in previous.get('threads',[])} if previous else {}
        try: tasks=sorted((x for x in (proc/'task').iterdir() if x.name.isdigit()),key=lambda x:int(x.name))
        except OSError as error: tasks=[]; unavailable.append({'field':'threads','reason':type(error).__name__})
        row['threadsTruncated']=len(tasks)>256
        for task in tasks[:256]:
            try: thread=self._stat(task/'stat')
            except (OSError,ValueError,IndexError) as error: unavailable.append({'field':'thread.'+task.name,'reason':type(error).__name__}); continue
            old=old_threads.get((thread['pid'],thread['start']))
            thread['cpuSecondsDelta']=self._delta(thread['cpuSeconds'],old.get('cpuSeconds') if old else None)
            thread['meanCpusSincePrevious']=thread['cpuSecondsDelta']/wall if wall and thread['cpuSecondsDelta'] is not None else None
            thread['wchan']=self._text(task/'wchan',unavailable,'thread.'+task.name+'.wchan'); threads.append(thread)
        row['threads']=threads
        try: same_end=self._same(self._stat(proc/'stat'),expected)
        except (OSError,ValueError,IndexError): same_end=False
        row['identityMatchedAtEnd']=same_end
        if not same_end: return {'at':row['at'],'optimizerElapsedSeconds':elapsed,'expectedIdentity':expected,'identityMatched':False,'reason':'identity changed while sampling','unavailable':unavailable}
        return row

    def sample(self, expected, elapsed):
        if self.disabled or (self.last_elapsed is not None and elapsed-self.last_elapsed<self.interval): return
        if self.rows>=self.maximum_rows: self.disabled='row limit'; return
        self.last_elapsed=elapsed
        try: row=self._collect(expected,elapsed)
        except Exception as error:
            self.errors+=1; row={'optimizerElapsedSeconds':elapsed,'expectedIdentity':expected,'observationError':repr(error)}
        encoded=(json.dumps(row,separators=(',',':'))+'\n').encode()
        if self.bytes+len(encoded)>self.maximum_bytes: self.disabled='byte limit'; return
        try:
            with self.path.open('ab') as stream: stream.write(encoded)
        except OSError as error: self.disabled='write error: '+type(error).__name__; self.errors+=1; return
        self.rows+=1; self.bytes+=len(encoded)
        if row.get('identityMatched') and row.get('identityMatchedAtEnd'): self.previous=row
        if elapsed>=self.milestone and not self.milestone_recorded:
            self.milestone_recorded=True
            milestone={'event':'optimizer-comparison-milestone','comparisonSeconds':self.milestone,'observedElapsedSeconds':elapsed,'deadlineExtendedExplicitly':self.deadline_extended,'optimizerIdentity':expected,'observationFile':str(self.path)}
            try: (self.output/'optimizer-530s-milestone.json').write_text(json.dumps(milestone,indent=2)+'\n')
            except OSError: self.errors+=1
            print(json.dumps(milestone,separators=(',',':')),flush=True)

    def summary(self):
        return {'path':str(self.path),'sampleSeconds':self.interval,'maximumRows':self.maximum_rows,'maximumBytes':self.maximum_bytes,
                'rows':self.rows,'bytes':self.bytes,'errors':self.errors,'disabledReason':self.disabled,'milestoneSeconds':self.milestone,
                'milestoneRecorded':self.milestone_recorded,'optimizerFlagsChanged':False,'missingFieldsAreUnknown':True}
