# 기본 곡 만들기: 악보(LilyPond 일부 문법)로 반주(MR)와 글자 단위 가사 시간(LRC)을 만든다.
#   python scripts/make-songs.py   →  app/songs/*.m4a, app/songs/index.json
# 저작권이 없는 곡(전래 민요·동요, 보호기간이 끝난 곡)만 넣는다.
# 악보 출처: 위키백과 각 문서의 악보 (CC BY-SA 4.0). 생일 축하합니다는 직접 옮겨 적음.
import json, math, os, re, subprocess, sys, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'songs')
SR = 44100

# 가사 적는 법: 글자 하나 = 음 하나. 띄어쓰기는 화면용.
#   ~  앞 글자를 다음 음까지 끌기     {이라}  한 음에 여러 글자
SONGS = [
    dict(id='arirang', title='아리랑', artist='경기 민요', source='위키백과 「Arirang」 악보',
         score=r'''\relative f' { \key f \major \time 9/8 \tempo "Lento" 4 = 140
c4. ~ c4 d8 c4 ( d8 ) | f4. ~ f4 g8 f4 ( g8 ) | a4. g8( a g) f4 ( d8 ) | c4. ~ ( c4 d8 c d ) r8 |
f4. ~ f4 g8 f4 ( g8 ) | a4 ( g8 ) f4 ( d8 ) c4 ( d8 ) | f4. ~ f4 g8 f4.| f4. ~ f4. r4. |
c'4. ~ c c | c4. a4. g4. | a4. g4 a8 f4 ( d8 ) | c4. ~ ( c4 d8 c d ) r8 |
f4. ~ f4 g8 f4 ( g8 ) | a4 ( g8 ) f4 ( d8 ) c4 ( d8 ) | f4. ~ f4 g8 f4.| f4. ~ f4. r4. }''',
         verses=[
             ['아리랑 아리랑 아라리요', '아리랑 고개로 넘어간다', '나를 버리고 가시는 님은', '십리도 못 가서 발병 난다'],
             ['아리랑 아리랑 아라리요', '아리랑 고개로 넘어간다', '청천 하늘엔 별도~ 많고', '우리네 가슴엔 꿈도 많다'],
             ['아리랑 아리랑 아라리요', '아리랑 고개로 넘어간다', '저기 저 산이 백두산{이라}지', '동지섣달에도 꽃만 핀다'],
         ]),
    dict(id='miryang', title='밀양아리랑', artist='경남 민요', source='위키백과 「밀양아리랑」 악보',
         score=r'''\relative c' { \key f \major \time 9/8 \tempo "" 4 = 150
d'8 d4 c8 d8 c8 a4. | d8 d4 c8 d8 c8 a4. | d4. c8 d8 c8 a8 g8 a8 | c4. ~ (c8 d8 c8 a4.) |
a8 a4 g4 f8 (d8 f4) | a8 a4 g4 c8 (a4 g8) | f4. f8 g8 f8 d8 c8 a8 | d4. ~ (d4 f8 d4.) |
d4 a8 d4 f8 d4. | d4 a8 d4 f8 d4. | d'8 d4 c8 d8 c8 a8 g8 a8 | c4. ~ (c8 d8 c8 a4.) |
a4. g4 f8 (d8 f4) | a4. g4 (c8) a4 (g8) | f4. f8 g8 f8 d8 c8 a8 | d4. ~ (d4 f8 d4.) }''',
         verses=[
             ['날 좀 보~~소 날 좀 보~~소 날 좀~~ 보~~소', '동지섣달 꽃 본 듯이 날 좀~~ 보~~소',
              '아리아리랑 쓰리쓰리랑 아라리~가 났~~네', '아리랑 고개로 날 넘~겨 주~~소'],
             ['정든 님~~이 오셨는~~데 인사~도 못~~해', '행주치마 입에 물고 입만~~ 방~~긋',
              '아리아리랑 쓰리쓰리랑 아라리~가 났~~네', '아리랑 고개로 날 넘~겨 주~~소'],
         ]),
    dict(id='doraji', title='도라지 타령', artist='경기 민요', source='위키백과 「도라지타령」 악보',
         score=r'''\relative c' { \key f \major \time 9/8 \tempo "" 4. = 110
a'4. a4. a4. | a4. ~ a4 g8 f4. | c'4. ~ c4. d4 ( c8 ) | a4. ~ ( a4 g8 ) f4. |
g4 (a8) a4. ~ a4. | g4 ( a8 ) g4 ( f8 ) d8  ( c4 ) | d4. f4. ~ f4 d8 | c4. ~ c4. r4. |
a'4. a4. ~ a4. | a4. ~ a4 g8 f4. | c'4. ~ c4. d4 ( c8 ) | a4. ~ ( a4 g8 f4. ) |
g4 a8 a4. a4. | g4 ( a8 ) g4 ( f8 ) d8  ( c4 ) | d4. f4. ~ f4 d8 | c4. ~ c4. r4. |
d4. d4 ( f8 ) c4. | d4. d4 ( f8 ) c4. | f4. f4. ~ ( f4 g8 ) | f4. ~ ( f4. g4. ) |
a4. a4. a4. | a4. ~ ( a4 g8 ) f4. | c'4 c8 c4. ( d4 c8 ) | a4. ~ ( a4 g8 ) f4. |
g4 (a8) a4. a4. | g4 ( a8 ) g4 ( f8 ) d8  ( c4 ) | d4. f4. d4. | c4. ~ c4. r4. }''',
         verses=[[
             '도라지 도라지 백도라지', '심심산천에 백도라지', '한두 뿌리만 캐어도', '대바구니 철철철 다 넘는다',
             '에헤요 에헤요 에헤요', '에야라 난다 지화자 좋다', '얼씨구 좋구나 내 사랑아',
         ]]),
    dict(id='hanobaengnyeon', title='한오백년', artist='강원 민요', source='위키백과 「한오백년」 악보',
         score=r'''\relative c' { \key g \major \time 12/4 \tempo "Lento" 4 = 72
b8 b8 b2 e8 e~e4 e8(g) | b8 b8 a16(g16 b8) a8(g8) e16(d16 b8 ~ b4 e16 d16 b8) |
e8 e8 e4 e8(g8) b8 b8 a8(g8) e16(d16 b8) | e4 e8(g8) a16(g16 e8) e4 ~ e4 r4 |
d'8 b8 b2 b8 b8 b2 | b8 b8 a16(g16 b8) a8(g8) e16(d16 b8 ~ b4 e16 d16 b8) |
e8 e8 e4 e8(g8)  g8 b8 a8(g8) e16(d16 b8) | e8 e8 e8(g8) a16(g16 e8) e4 ~ e4 r4 }''',
         verses=[['아무렴 그렇지', '그렇고 말고', '한오백년 살자는데', '웬 성화요',
                  '한 많은 이 세상', '야속한 임아', '정을 두고 몸만 가니', '눈물이 나네']]),
    dict(id='dongdaemun', title='동대문을 열어라', artist='전래 동요', source='위키백과 「동대문을 열어라」 악보',
         score=r'''\relative c' { \key a \minor \time 4/4 \tempo "" 4 = 112
g'4 g g8 a g f | e4 e e r4 | f4 f f8 g f e | d4 d d r |
c4 d e f | g a g r | c g e d | c2 r2 }''',
         verses=[['동동동 대문을 열어라', '남남남 대문을 열어라', '열두 시가 되면은', '문을 닫는다']] * 2),
    dict(id='birthday', title='생일 축하합니다', artist='Happy Birthday', source='직접 옮겨 적음 (가락은 저작권 만료)',
         score=r'''\relative c' { \key g \major \time 3/4 \tempo "" 4 = 100
r2 d8. d16 | e4 d g | fis2 d8. d16 | e4 d a' | g2 d8. d16 | d'4 b g | fis e c'8. c16 | b4 g a | g2. }''',
         verses=[['생일 축하합{니다}', '생일 축하합{니다}', '사랑하는 주인공', '생일 축하합{니다}']] * 2),
    dict(id='twinkle', title='Twinkle Twinkle Little Star', artist='영국 동요', source='위키백과 「작은 별」 악보',
         score=r'''\relative c' { \key c \major \time 4/4 \tempo "" 4 = 100
c4 c4 g'4 g4 a4 a4 g2 f4 f4 e4 e4 d4 d4 c2
g'4 g4 f4 f4 e4 e4 d2 g4 g4 f4 f4 e4 e4 d2
c4 c4 g'4 g4 a4 a4 g2 f4 f4 e4 e4 d4 d4 c2 }''',
         verses=[['{Twin}{kle} {twin}{kle} {lit}{tle} {star}', '{How} {I} {won}{der} {what} {you} {are}',
                  '{Up} {a}{bove} {the} {world} {so} {high}', '{Like} {a} {dia}{mond} {in} {the} {sky}',
                  '{Twin}{kle} {twin}{kle} {lit}{tle} {star}', '{How} {I} {won}{der} {what} {you} {are}']]),
]

# ---------------- 악보 읽기 ----------------
STEPS = 'cdefgab'
PC = dict(c=0, d=2, e=4, f=5, g=7, a=9, b=11)

def parse(score):
    m = re.search(r"\\relative\s+([a-g])([',]*)", score)
    ref_step, ref_oct = STEPS.index(m.group(1)), 3 + m.group(2).count("'") - m.group(2).count(',')
    t = re.search(r'\\time\s+(\d+)/(\d+)', score)
    num, den = int(t.group(1)), int(t.group(2))
    tm = re.search(r'\\tempo[^=]*?(\d+)(\.?)\s*=\s*(\d+)', score)
    beat_len = 1 / int(tm.group(1)) * (1.5 if tm.group(2) else 1)
    sec_per_whole = 60 / int(tm.group(3)) / beat_len
    body = score[score.index('{', m.end()) + 1:]
    body = re.sub(r'\\(key\s+\w+\s+\\\w+|time\s+\S+|tempo\s+"[^"]*"\s*\S+\s*=\s*\d+|tempo\s+\S+\s*=\s*\d+)', ' ', body)
    notes, dur, pos = [], 0.25, 0.0
    tie_next = slur = False
    for tok in re.finditer(r"([a-g](?:is|es)*|r)([',]*)(\d+)?(\.*)|~|\(|\)", body):
        s = tok.group(0)
        if s == '~': tie_next = True; continue
        if s == '(':
            if notes: notes[-1]['slur_start'] = True
            slur = True; continue
        if s == ')': slur = False; continue
        name, octs, d, dots = tok.groups()
        if d: dur = 1 / int(d) * (2 - 0.5 ** len(dots)) if dots else 1 / int(d)
        elif dots: pass
        if name == 'r':
            pos += dur; tie_next = False; continue
        step = STEPS.index(name[0])
        # \relative: 앞 음에서 4도 안쪽으로 가장 가까운 옥타브
        best = None
        for o in (ref_oct - 1, ref_oct, ref_oct + 1):
            dist = (o * 7 + step) - (ref_oct * 7 + ref_step)
            if abs(dist) <= 3 and (best is None or abs(dist) < abs(best[1])): best = (o, dist)
        octv = best[0] + octs.count("'") - octs.count(',')
        ref_step, ref_oct = step, octv
        midi = 12 * (octv + 1) + PC[name[0]] + name.count('is') - name.count('es')
        n = dict(midi=midi, start=pos, dur=dur, syll=True)
        if tie_next and notes and notes[-1]['midi'] == midi:
            notes[-1]['dur'] += dur          # 붙임줄: 한 음으로 합친다
            tie_next = False
            pos += dur
            if slur and not notes[-1].get('slur_start'): notes[-1]['in_slur'] = True
            continue
        tie_next = False
        if slur: n['syll'] = False           # 이음줄 안의 음은 앞 글자를 끈다
        notes.append(n)
        pos += dur
    # 이음줄 시작 음은 글자를 받는다
    return dict(notes=notes, length=pos, bar=num / den, num=num, den=den, spw=sec_per_whole)

# ---------------- 화음 고르기 ----------------
def pick_chords(sc):
    notes = sc['notes']
    tonic = notes[-1]['midi'] % 12
    minor = sum(n['dur'] for n in notes if n['midi'] % 12 == (tonic + 3) % 12) > sum(n['dur'] for n in notes if n['midi'] % 12 == (tonic + 4) % 12)
    scale = [0, 2, 3, 5, 7, 8, 10] if minor else [0, 2, 4, 5, 7, 9, 11]
    pref = [1.0, 0.5, 0.55, 0.85, 0.9, 0.7, 0.6] if minor else [1.0, 0.55, 0.45, 0.9, 0.9, 0.7, 0.3]
    cands = []
    for deg in range(7):
        r = scale[deg]
        triad = [(tonic + scale[(deg + k) % 7]) % 12 for k in (0, 2, 4)]
        if not minor and deg == 6: continue      # 장조 7도(감화음)는 빼기
        if minor and deg == 1: continue
        cands.append(dict(root=(tonic + r) % 12, pcs=triad, pref=pref[deg]))
    num, den = sc['num'], sc['den']
    if num == 12 and den == 4: seg = 3 / 4
    elif num % 3 == 0 and num > 3 and den == 8: seg = 3 / 8 * (num // 3) if num == 9 else 3 / 8 * 2
    elif num == 4: seg = 2 / 4
    else: seg = num / den
    out, prev = [], None
    total = sc['length']
    k = 0
    while k * seg < total - 1e-9:
        a, b = k * seg, min(total, (k + 1) * seg)
        w = {}
        for n in notes:
            o = max(0, min(b, n['start'] + n['dur']) - max(a, n['start']))
            if o > 0: w[n['midi'] % 12] = w.get(n['midi'] % 12, 0) + o
        best, bs = None, -1e9
        for c in cands:
            s = sum(v * (1.2 if pc == c['root'] else 0.9 if pc in c['pcs'] else -0.7) for pc, v in w.items())
            s += 0.08 * c['pref'] + (0.05 if prev is c else 0)
            if (k == 0 or b >= total - 1e-9) and c['root'] == tonic: s += 0.3
            if not w: s = 1 if prev is c else (0.5 if c['root'] == tonic else 0)
            if s > bs: best, bs = c, s
        out.append(dict(start=a, dur=b - a, chord=best))
        prev = best
        k += 1
    return out

# ---------------- 소리 만들기 ----------------
def mtof(m): return 440 * 2 ** ((m - 69) / 12)

def env_adsr(n, a, r, sus=1.0):
    e = np.ones(n) * sus
    ai = min(n, int(a * SR)); ri = min(n - ai, int(r * SR))
    if ai: e[:ai] = np.linspace(0, sus, ai)
    if ri: e[n - ri:] *= np.linspace(1, 0, ri)
    return e

def add(buf, start, sig, pan=0.0):
    i = int(start * SR)
    if i >= buf.shape[1]: return
    sig = sig[:buf.shape[1] - i]
    buf[0, i:i + len(sig)] += sig * (1 - pan) ** 0.5 * 1.0
    buf[1, i:i + len(sig)] += sig * (1 + pan) ** 0.5 * 1.0

def tone_melody(f, sec):
    n = int((sec + 0.12) * SR); t = np.arange(n) / SR
    vib = 1 + 0.005 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.25) * 3, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    y = np.sin(ph) + 0.3 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph) + 0.05 * np.sin(4 * ph)
    return y * env_adsr(n, 0.035, 0.14, 0.85) * 0.2

def tone_piano(f, sec):
    n = int((sec + 0.4) * SR); t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (1.6 + k * 1.3)) for k, a in ((1, 1), (2, 0.45), (3, 0.18), (4, 0.08)))
    return y * env_adsr(n, 0.004, 0.3) * 0.075

def tone_bass(f, sec):
    n = int((sec + 0.2) * SR); t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return y * np.exp(-t * 1.8) * env_adsr(n, 0.008, 0.15) * 0.22

def tone_pad(f, sec):
    n = int((sec + 0.5) * SR); t = np.arange(n) / SR
    y = sum(np.sin(2 * np.pi * f * d * t) for d in (0.997, 1.0, 1.003)) / 3
    return y * env_adsr(n, min(0.4, sec / 2), 0.5) * 0.035

rng = np.random.default_rng(7)
def kick():
    n = int(0.25 * SR); t = np.arange(n) / SR
    f = 50 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * 0.38
def hat(level=0.04):
    n = int(0.06 * SR); t = np.arange(n) / SR
    x = np.diff(rng.standard_normal(n + 1))
    return x * np.exp(-t * 70) * level
def rim():
    n = int(0.09 * SR); t = np.arange(n) / SR
    x = np.diff(rng.standard_normal(n + 1)) * 0.5 + np.sin(2 * np.pi * 820 * t)
    return x * np.exp(-t * 45) * 0.06

def voicing(chord, center=62):
    out = []
    for pc in chord['pcs']:
        m = pc + 12 * round((center - pc) / 12)
        out.append(m)
    return sorted(out)

def render_block(buf, at, sc, chords, melody=True, sec_offset=0.0):
    spw = sc['spw']
    if melody:
        for n in sc['notes']:
            add(buf, at + n['start'] * spw, tone_melody(mtof(n['midi']), n['dur'] * spw))
    num, den = sc['num'], sc['den']
    compound = num % 3 == 0 and num > 3
    unit = 1 / den
    beat = unit * 3 if compound else unit
    for c in chords:
        a, d = c['start'], c['dur']
        ch = c['chord']
        vs = voicing(ch)
        root = ch['root'] + 36
        if root < 38: root += 12
        # 패드
        for m in vs: add(buf, at + a * spw, tone_pad(mtof(m), d * spw), pan=0)
        # 베이스: 마디 첫 박 + 중간
        add(buf, at + a * spw, tone_bass(mtof(root), d * spw * 0.6))
        if d > beat * 1.5:
            fifth = root + 7 if root + 7 < 50 else root - 5
            add(buf, at + (a + d / 2) * spw, tone_bass(mtof(fifth), d * spw * 0.4))
        # 피아노: 박마다 펼친화음
        steps = int(round(d / unit))
        for s in range(steps):
            tt = a + s * unit
            if compound:
                m = vs[[0, 1, 2][s % 3]] + (12 if s % 3 == 2 else 0)
                add(buf, at + tt * spw, tone_piano(mtof(m), unit * spw * 1.5), pan=-0.3)
            elif s % 1 == 0:
                if s % 2 == 0:
                    for m in vs: add(buf, at + tt * spw, tone_piano(mtof(m), unit * spw), pan=-0.3)
                else:
                    add(buf, at + tt * spw, tone_piano(mtof(vs[-1] + 12), unit * spw * 0.6) * 0.6, pan=-0.3)
    # 장단: 큰북·작은 소리
    step = unit if (compound or den == 8) else unit / 2
    per_bar, per_beat = round(sc['bar'] / step), round(beat / step)
    for k in range(round(sc['length'] / step)):
        tt = at + k * step * spw
        if k % per_bar == 0: add(buf, tt, kick())
        elif k % per_beat == 0: add(buf, tt, rim(), pan=0.2)
        add(buf, tt, hat(0.045 if k % per_beat == 0 else 0.03), pan=0.4)

# ---------------- 가사 ----------------
def lyric_tokens(line):
    toks, i = [], 0
    while i < len(line):
        ch = line[i]
        if ch == ' ':
            if toks: toks[-1]['text'] += ' '
            i += 1
        elif ch == '~':
            toks.append(dict(text='', hold=True)); i += 1
        elif ch == '{':
            j = line.index('}', i); toks.append(dict(text=line[i + 1:j], hold=False)); i = j + 1
        else:
            toks.append(dict(text=ch, hold=False)); i += 1
    return toks

def ts(sec):
    return f'{int(sec // 60):02d}:{sec % 60:05.2f}'

def build(song):
    sc = parse(song['score'])
    chords = pick_chords(sc)
    spw = sc['spw']
    bar_sec = sc['bar'] * spw
    intro_bars = max(1, round(7 / bar_sec))
    intro_len = intro_bars * sc['bar']
    # 전주: 마지막 몇 마디
    cut = sc['length'] - intro_len
    intro = dict(sc, notes=[dict(n, start=n['start'] - cut) for n in sc['notes'] if n['start'] >= cut - 1e-9], length=intro_len)
    intro_ch = [dict(c, start=c['start'] - cut) for c in chords if c['start'] >= cut - 1e-9]
    verse_sec = sc['length'] * spw
    total = intro_len * spw + (verse_sec + intro_len * spw) * len(song['verses']) + 3
    buf = np.zeros((2, int(total * SR) + SR))
    t = 0.0
    render_block(buf, t, intro, intro_ch); t += intro_len * spw
    lrc, syl_notes = [], [n for n in sc['notes'] if n['syll']]
    for vi, verse in enumerate(song['verses']):
        render_block(buf, t, sc, chords)
        # 글자 ↔ 음 맞추기
        lines = [lyric_tokens(l) for l in verse]
        flat = [tk for l in lines for tk in l]
        if len(flat) != len(syl_notes):
            sys.exit(f"{song['title']} {vi + 1}절: 글자 {len(flat)}개, 음 {len(syl_notes)}개 — 가사를 맞춰 주세요")
        # 끌기(~)는 앞 글자 길이에 더하고 시간은 음 시작으로
        idx = 0
        for l in lines:
            segs = []
            for tk in l:
                n = syl_notes[idx]; idx += 1
                if tk['hold']:
                    if segs: segs[-1][1] += tk['text']
                    continue
                parts = list(tk['text'].rstrip(' ')) if len(tk['text'].strip()) > 1 and all('\uac00' <= c <= '\ud7a3' for c in tk['text'].strip()) else [tk['text']]
                if len(parts) > 1:   # 한 음에 한글 여러 글자: 음 길이를 나눠 쓴다
                    step = n['dur'] * spw / len(parts)
                    for k, p in enumerate(parts):
                        segs.append([t + n['start'] * spw + k * step, p])
                    if tk['text'].endswith(' '): segs[-1][1] += ' '
                else:
                    segs.append([t + n['start'] * spw, tk['text']])
            text = ''.join(f'<{ts(s)}>{w}' for s, w in segs)
            lrc.append(f'[{ts(segs[0][0])}]{text}')
        t += verse_sec
        if vi < len(song['verses']) - 1:
            render_block(buf, t, intro, intro_ch); t += intro_len * spw
    # 끝맺음 화음
    last = chords[-1]['chord']
    for m in voicing(last): add(buf, t, tone_pad(mtof(m), 2.5) * 2.5); add(buf, t, tone_piano(mtof(m), 2.5))
    add(buf, t, tone_bass(mtof(last['root'] + 36 if last['root'] + 36 >= 38 else last['root'] + 48), 2.5))
    add(buf, t, kick())
    end = int((t + 3) * SR)
    buf = buf[:, :end]
    buf = np.tanh(buf * 1.4) / np.tanh(1.4)
    buf *= 0.89 / np.max(np.abs(buf))
    return buf, '\n'.join(lrc), t + 3

def save(buf, path):
    wav = path + '.wav'
    with wave.open(wav, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((buf.T * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path + '.m4a'], check=True)
    os.remove(wav)

def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    index = []
    for song in SONGS:
        if only and song['id'] not in only: continue
        buf, lrc, dur = build(song)
        save(buf, os.path.join(OUT, song['id']))
        index.append(dict(id='builtin-' + song['id'], title=song['title'], artist=song['artist'], src=f"songs/{song['id']}.m4a",
                          duration=round(dur), lrc=lrc, credit=song['source']))
        print(f"{song['title']}: {dur:.0f}초")
    if not only:
        with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
