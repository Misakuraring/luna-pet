/**
 * Luna · 宠物模块
 * Step 1.3-A：内联 SVG 三态造型（IDLE / HAPPY / SLEEP）与基础姿态切换
 *
 * 设计约定：
 *   1. 三种状态共用同一 viewBox（0 0 240 240）与同一站立基准线（脚底 y = 228），
 *      切换时角色主体不位移、不裁切；
 *   2. 主要部位独立 <g> 分组并带语义化 class（luna-hair-back / luna-tail / luna-ears /
 *      luna-body / luna-head / luna-eyes / luna-mouth / luna-effects …），供 CSS 关键帧驱动；
 *   3. 造型只在挂载时注入一次，状态切换仅改容器的 data-mood，不重建 DOM。
 *
 * 对外接口：
 *   initPet()  → 挂载 SVG 并绑定点击预览，返回是否成功
 *   setMood(m) → 直接设定造型（'IDLE' | 'HAPPY' | 'SLEEP'），返回生效值
 *   playHappy()→ 非 SLEEP 时临时切 HAPPY，happyDurationMs 后回落 IDLE
 *   MOOD       → 造型常量
 */

import { PET_CONFIG } from './config.js';
import eventBus from './core/eventBus.js';

export const MOOD = {
  IDLE: 'IDLE',
  HAPPY: 'HAPPY',
  SLEEP: 'SLEEP',
};

const CONTAINER_ID = 'luna-pet';

/* --------------------------------------------------------------------------
   配色（与要求一致）
   发色/尾巴渐变：矢车菊紫蓝 #7B88F0 → 梦幻粉紫 #D884F5
   猫耳内侧 #F9D8E6 / 左眼玫瑰粉 #E84A8A / 右眼琥珀金 #F5B027
   裙装深靛蓝 #232642 / 荷叶边 #F8F9FC / 深色衣物描边 #8C96E8
   -------------------------------------------------------------------------- */

const LUNA_SVG = `
<svg class="luna-svg" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Luna，星光紫蓝渐变猫娘桌宠">
  <defs>
    <linearGradient id="lunaHairGrad" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#7B88F0"/>
      <stop offset="0.55" stop-color="#A98BF2"/>
      <stop offset="1" stop-color="#D884F5"/>
    </linearGradient>
    <linearGradient id="lunaHairGradSoft" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#B7C0FF" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#E4B4FA" stop-opacity="0.3"/>
    </linearGradient>
    <linearGradient id="lunaTailGrad" x1="0.1" y1="0.9" x2="0.9" y2="0.1">
      <stop offset="0" stop-color="#7B88F0"/>
      <stop offset="0.5" stop-color="#A77DF1"/>
      <stop offset="1" stop-color="#D884F5"/>
    </linearGradient>
    <linearGradient id="lunaStarGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8FA6FF"/>
      <stop offset="0.5" stop-color="#C79BFF"/>
      <stop offset="1" stop-color="#F3A3F8"/>
    </linearGradient>
    <linearGradient id="lunaEyePinkGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#A81E5C"/>
      <stop offset="0.45" stop-color="#E84A8A"/>
      <stop offset="1" stop-color="#FF9BC0"/>
    </linearGradient>
    <linearGradient id="lunaEyeAmberGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#A96203"/>
      <stop offset="0.45" stop-color="#F5B027"/>
      <stop offset="1" stop-color="#FFDC85"/>
    </linearGradient>
    <linearGradient id="lunaDressGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2B3052"/>
      <stop offset="1" stop-color="#1C1F35"/>
    </linearGradient>
    <linearGradient id="lunaSkinGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF2EA"/>
      <stop offset="1" stop-color="#F7DBCD"/>
    </linearGradient>
    <linearGradient id="lunaShoeGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4B3A7A"/>
      <stop offset="1" stop-color="#2C2350"/>
    </linearGradient>

    <symbol id="lunaStar" viewBox="-12 -12 24 24" overflow="visible">
      <path d="M0 -10 C1.7 -3.5 3.5 -1.7 10 0 C3.5 1.7 1.7 3.5 0 10 C-1.7 3.5 -3.5 1.7 -10 0 C-3.5 -1.7 -1.7 -3.5 0 -10 Z"/>
    </symbol>
    <symbol id="lunaHeart" viewBox="0 0 24 24" overflow="visible">
      <path d="M12 21.2 C4.6 15.6 1.6 11.2 1.6 7.6 C1.6 4.2 4.1 1.6 7.3 1.6 C9.4 1.6 11.1 2.8 12 4.6 C12.9 2.8 14.6 1.6 16.7 1.6 C19.9 1.6 22.4 4.2 22.4 7.6 C22.4 11.2 19.4 15.6 12 21.2 Z"/>
    </symbol>
  </defs>

  <!-- ============ IDLE 待机 ============ -->
  <g class="luna-state luna-state--idle">
    <ellipse class="luna-shadow" cx="120" cy="226" rx="60" ry="9" fill="#8C96E8" opacity="0.15"/>

    <g class="luna-breathe">
      <!-- 后发 -->
      <g class="luna-hair-back">
        <path d="M120 44 C86 44 66 66 64 100 C60 134 52 158 60 182 C68 200 92 196 100 186 C106 200 136 200 142 186 C150 196 176 200 182 182 C190 158 180 134 176 100 C174 66 154 44 120 44 Z" fill="url(#lunaHairGrad)"/>
        <path d="M120 52 C92 52 76 72 74 100" fill="none" stroke="url(#lunaHairGradSoft)" stroke-width="6" stroke-linecap="round"/>
        <path d="M167 100 C170 128 176 154 172 178" fill="none" stroke="#F2BEFA" stroke-width="4" stroke-linecap="round" opacity="0.4"/>
      </g>

      <!-- 蓬松大尾巴 -->
      <g class="luna-tail">
        <path d="M142 194 C172 203 200 196 209 176 C218 157 213 138 199 128 C191 122 181 120 173 123 C185 131 193 143 192 157 C191 169 181 177 167 181 C157 184 148 187 142 194 Z" fill="url(#lunaTailGrad)"/>
        <path d="M160 190 C184 194 202 186 208 170" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" opacity="0.28"/>
        <path d="M195 142 C200 152 199 163 193 171" fill="none" stroke="#F6C8FB" stroke-width="5" stroke-linecap="round" opacity="0.45"/>
      </g>

      <!-- 猫耳 -->
      <g class="luna-ears">
        <path d="M62 78 C68 58 76 42 84 32 C92 48 99 62 103 74 Z" fill="url(#lunaHairGrad)" stroke="#7B88F0" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M178 78 C172 58 164 42 156 32 C148 48 141 62 137 74 Z" fill="url(#lunaHairGrad)" stroke="#7B88F0" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M70 71 C74 58 79 48 84 40 C89 51 93 61 95 68 Z" fill="#F9D8E6"/>
        <path d="M170 71 C166 58 161 48 156 40 C151 51 147 61 145 68 Z" fill="#F9D8E6"/>
      </g>

      <!-- 身体：星光小裙装 -->
      <g class="luna-body">
        <path d="M110 128 h20 v22 h-20 z" fill="url(#lunaSkinGrad)"/>

        <path d="M97 146 C90 150 87 158 88 166 C94 168 100 166 102 160 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <path d="M143 146 C150 150 153 158 152 166 C146 168 140 166 138 160 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>

        <path d="M98 150 C106 144 134 144 142 150 L146 166 C138 172 102 172 94 166 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <path d="M100 150 C106 146 134 146 140 150" fill="none" stroke="#F8F9FC" stroke-width="3" stroke-linecap="round"/>

        <rect x="94" y="161" width="52" height="7" rx="3.5" fill="#6B4FA8" stroke="#8C96E8" stroke-width="1"/>
        <use href="#lunaStar" x="108" y="140" width="24" height="24" fill="url(#lunaStarGrad)"/>

        <path d="M94 165 L146 165 L155 195 C142 202 98 202 85 195 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <path d="M107 167 L104 195 M120 167 L120 196 M133 167 L136 195" fill="none" stroke="#8C96E8" stroke-width="1" opacity="0.45"/>
        <path d="M86 193 q7 9 14 0 q7 9 14 0 q7 9 14 0 q7 9 14 0 q7 9 14 0" fill="none" stroke="#F8F9FC" stroke-width="6" stroke-linecap="round"/>

        <path d="M97 158 C88 168 82 178 80 187" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="10" stroke-linecap="round"/>
        <path d="M143 158 C152 168 158 178 160 187" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="10" stroke-linecap="round"/>
        <circle cx="79" cy="190" r="6.5" fill="url(#lunaSkinGrad)" stroke="#F3D3C4" stroke-width="1"/>
        <circle cx="161" cy="190" r="6.5" fill="url(#lunaSkinGrad)" stroke="#F3D3C4" stroke-width="1"/>

        <path d="M107 196 v14" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="12" stroke-linecap="round"/>
        <path d="M133 196 v14" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="12" stroke-linecap="round"/>
        <ellipse cx="107" cy="209" rx="9.5" ry="8" fill="#F8F9FC" stroke="#DCE0F2" stroke-width="1"/>
        <ellipse cx="133" cy="209" rx="9.5" ry="8" fill="#F8F9FC" stroke="#DCE0F2" stroke-width="1"/>
        <rect x="95" y="216" width="24" height="9" rx="4.5" fill="url(#lunaShoeGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <rect x="121" y="216" width="24" height="9" rx="4.5" fill="url(#lunaShoeGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <rect x="94" y="223" width="26" height="5" rx="2.5" fill="#6B4FA8"/>
        <rect x="120" y="223" width="26" height="5" rx="2.5" fill="#6B4FA8"/>
      </g>

      <!-- 头部：异色瞳 + 丸子发髻 + 星芒发饰 -->
      <g class="luna-head">
        <ellipse cx="120" cy="94" rx="45" ry="43" fill="url(#lunaSkinGrad)" stroke="#F3D3C4" stroke-width="1"/>

        <path d="M74 84 C64 106 62 134 70 158 C74 168 83 166 85 156 C78 132 78 106 83 88 Z" fill="url(#lunaHairGrad)"/>
        <path d="M166 84 C176 106 178 134 170 158 C166 168 157 166 155 156 C162 132 162 106 157 88 Z" fill="url(#lunaHairGrad)"/>

        <path d="M74 86 C72 60 92 44 120 44 C148 44 168 60 166 86 C160 92 152 88 146 98 C142 82 132 78 124 92 C118 78 108 80 100 96 C94 84 82 90 74 86 Z" fill="url(#lunaHairGrad)"/>
        <path d="M92 62 C102 54 116 51 128 53" fill="none" stroke="url(#lunaHairGradSoft)" stroke-width="4" stroke-linecap="round"/>

        <g class="luna-eyes">
          <ellipse cx="100" cy="104" rx="12.5" ry="15" fill="#2A1B33"/>
          <ellipse cx="100" cy="106" rx="9.6" ry="12" fill="url(#lunaEyePinkGrad)"/>
          <ellipse cx="100" cy="110" rx="4.4" ry="6.4" fill="#5A1030" opacity="0.75"/>
          <circle cx="95.5" cy="98" r="3.6" fill="#FFFFFF" opacity="0.95"/>
          <circle cx="104" cy="112" r="1.7" fill="#FFFFFF" opacity="0.7"/>
          <path d="M88.5 92 C94 85.5 106 85.5 111.5 91.5" fill="none" stroke="#2A1B33" stroke-width="3.6" stroke-linecap="round"/>

          <ellipse cx="140" cy="104" rx="12.5" ry="15" fill="#2A1B33"/>
          <ellipse cx="140" cy="106" rx="9.6" ry="12" fill="url(#lunaEyeAmberGrad)"/>
          <ellipse cx="140" cy="110" rx="4.4" ry="6.4" fill="#6B3A00" opacity="0.7"/>
          <circle cx="135.5" cy="98" r="3.6" fill="#FFFFFF" opacity="0.95"/>
          <circle cx="144" cy="112" r="1.7" fill="#FFFFFF" opacity="0.7"/>
          <path d="M128.5 92 C134 85.5 146 85.5 151.5 91.5" fill="none" stroke="#2A1B33" stroke-width="3.6" stroke-linecap="round"/>
        </g>

        <g class="luna-blush">
          <ellipse cx="86" cy="116" rx="9" ry="5" fill="#F27BA0" opacity="0.32"/>
          <ellipse cx="154" cy="116" rx="9" ry="5" fill="#F27BA0" opacity="0.32"/>
        </g>

        <g class="luna-mouth">
          <path d="M114 121 C117 126 123 126 126 121" fill="none" stroke="#9A3E5E" stroke-width="2.2" stroke-linecap="round"/>
        </g>

        <g class="luna-buns">
          <circle cx="62" cy="82" r="14" fill="url(#lunaHairGrad)"/>
          <path d="M56 77 q7 -6 13 1" fill="none" stroke="#F2BEFA" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
          <circle cx="178" cy="82" r="14" fill="url(#lunaHairGrad)"/>
          <path d="M172 77 q7 -6 13 1" fill="none" stroke="#F2BEFA" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
          <use href="#lunaStar" x="70" y="52" width="16" height="16" fill="url(#lunaStarGrad)"/>
          <use href="#lunaStar" x="156" y="50" width="16" height="16" fill="url(#lunaStarGrad)"/>
        </g>
      </g>
    </g>

    <g class="luna-effects">
      <use class="luna-spark luna-spark--1" href="#lunaStar" x="34" y="30" width="20" height="20" fill="url(#lunaStarGrad)"/>
      <use class="luna-spark luna-spark--2" href="#lunaStar" x="188" y="74" width="16" height="16" fill="url(#lunaStarGrad)"/>
      <use class="luna-spark luna-spark--3" href="#lunaStar" x="46" y="150" width="13" height="13" fill="url(#lunaStarGrad)"/>
    </g>
  </g>

  <!-- ============ HAPPY 开心 ============ -->
  <g class="luna-state luna-state--happy">
    <ellipse class="luna-shadow" cx="120" cy="226" rx="60" ry="9" fill="#8C96E8" opacity="0.15"/>

    <g class="luna-happy-jump">
      <g class="luna-hair-back">
        <path d="M120 44 C86 44 66 66 64 100 C60 134 52 158 60 182 C68 200 92 196 100 186 C106 200 136 200 142 186 C150 196 176 200 182 182 C190 158 180 134 176 100 C174 66 154 44 120 44 Z" fill="url(#lunaHairGrad)"/>
        <path d="M120 52 C92 52 76 72 74 100" fill="none" stroke="url(#lunaHairGradSoft)" stroke-width="6" stroke-linecap="round"/>
        <path d="M167 100 C170 128 176 154 172 178" fill="none" stroke="#F2BEFA" stroke-width="4" stroke-linecap="round" opacity="0.4"/>
      </g>

      <g class="luna-tail luna-tail--happy">
        <path d="M142 186 C172 195 200 188 209 168 C218 149 213 130 199 120 C191 114 181 112 173 115 C185 123 193 135 192 149 C191 161 181 169 167 173 C157 176 148 179 142 186 Z" fill="url(#lunaTailGrad)"/>
        <path d="M160 182 C184 186 202 178 208 162" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" opacity="0.28"/>
        <path d="M195 134 C200 144 199 155 193 163" fill="none" stroke="#F6C8FB" stroke-width="5" stroke-linecap="round" opacity="0.45"/>
      </g>

      <g class="luna-ears">
        <path d="M60 76 C66 56 75 40 84 30 C92 46 99 60 103 72 Z" fill="url(#lunaHairGrad)" stroke="#7B88F0" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M180 76 C174 56 165 40 156 30 C148 46 141 60 137 72 Z" fill="url(#lunaHairGrad)" stroke="#7B88F0" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M68 69 C72 56 78 46 84 38 C89 49 93 59 95 66 Z" fill="#F9D8E6"/>
        <path d="M172 69 C168 56 162 46 156 38 C151 49 147 59 145 66 Z" fill="#F9D8E6"/>
        <ellipse class="luna-ear-tip" cx="83" cy="37" rx="6.5" ry="8" fill="#F27BA0" opacity="0.45"/>
        <ellipse class="luna-ear-tip" cx="157" cy="37" rx="6.5" ry="8" fill="#F27BA0" opacity="0.45"/>
      </g>

      <g class="luna-body">
        <path d="M110 128 h20 v22 h-20 z" fill="url(#lunaSkinGrad)"/>
        <path d="M101 150 C93 142 89 134 87 126" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="11" stroke-linecap="round"/>
        <path d="M139 150 C147 142 151 134 153 126" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="11" stroke-linecap="round"/>

        <path d="M97 146 C90 150 87 158 88 166 C94 168 100 166 102 160 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <path d="M143 146 C150 150 153 158 152 166 C146 168 140 166 138 160 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>

        <path d="M98 150 C106 144 134 144 142 150 L146 166 C138 172 102 172 94 166 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <path d="M100 150 C106 146 134 146 140 150" fill="none" stroke="#F8F9FC" stroke-width="3" stroke-linecap="round"/>

        <rect x="94" y="161" width="52" height="7" rx="3.5" fill="#6B4FA8" stroke="#8C96E8" stroke-width="1"/>
        <use href="#lunaStar" x="108" y="140" width="24" height="24" fill="url(#lunaStarGrad)"/>

        <path d="M94 165 L146 165 L157 193 C143 201 97 201 83 193 Z" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <path d="M107 167 L103 195 M120 167 L120 196 M133 167 L137 195" fill="none" stroke="#8C96E8" stroke-width="1" opacity="0.45"/>
        <path d="M85 192 q7 10 14 0 q7 10 14 0 q7 10 14 0 q7 10 14 0 q7 10 14 0" fill="none" stroke="#F8F9FC" stroke-width="6" stroke-linecap="round"/>

        <path d="M107 196 v13" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="12" stroke-linecap="round"/>
        <path d="M133 195 v13" fill="none" stroke="url(#lunaSkinGrad)" stroke-width="12" stroke-linecap="round"/>
        <ellipse cx="107" cy="211" rx="10.5" ry="9.5" fill="#F8F9FC" stroke="#DCE0F2" stroke-width="1"/>
        <ellipse cx="133" cy="210" rx="10.5" ry="9.5" fill="#F8F9FC" stroke="#DCE0F2" stroke-width="1"/>
        <rect x="95" y="215" width="24" height="9" rx="4.5" fill="url(#lunaShoeGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <rect x="121" y="214" width="24" height="9" rx="4.5" fill="url(#lunaShoeGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <rect x="94" y="222" width="26" height="5" rx="2.5" fill="#6B4FA8"/>
        <rect x="120" y="221" width="26" height="5" rx="2.5" fill="#6B4FA8"/>
      </g>

      <g class="luna-head">
        <ellipse cx="120" cy="94" rx="45" ry="43" fill="url(#lunaSkinGrad)" stroke="#F3D3C4" stroke-width="1"/>

        <path d="M74 84 C64 106 62 134 70 158 C74 168 83 166 85 156 C78 132 78 106 83 88 Z" fill="url(#lunaHairGrad)"/>
        <path d="M166 84 C176 106 178 134 170 158 C166 168 157 166 155 156 C162 132 162 106 157 88 Z" fill="url(#lunaHairGrad)"/>

        <path d="M74 86 C72 60 92 44 120 44 C148 44 168 60 166 86 C160 92 152 88 146 98 C142 82 132 78 124 92 C118 78 108 80 100 96 C94 84 82 90 74 86 Z" fill="url(#lunaHairGrad)"/>
        <path d="M92 62 C102 54 116 51 128 53" fill="none" stroke="url(#lunaHairGradSoft)" stroke-width="4" stroke-linecap="round"/>

        <g class="luna-eyes luna-eyes--happy">
          <path d="M88 107 C94 96 106 96 112 105" fill="none" stroke="#2A1B33" stroke-width="4" stroke-linecap="round"/>
          <path d="M128 105 C134 96 146 96 152 107" fill="none" stroke="#2A1B33" stroke-width="4" stroke-linecap="round"/>
        </g>

        <g class="luna-blush">
          <ellipse cx="84" cy="116" rx="10" ry="5.4" fill="#F27BA0" opacity="0.45"/>
          <ellipse cx="156" cy="116" rx="10" ry="5.4" fill="#F27BA0" opacity="0.45"/>
        </g>

        <g class="luna-mouth">
          <path d="M112 118 C116 132 124 132 128 118 C124 123 116 123 112 118 Z" fill="#8C2F52"/>
          <ellipse cx="120" cy="126" rx="3.6" ry="2.4" fill="#F27BA0"/>
        </g>

        <g class="luna-buns">
          <circle cx="62" cy="82" r="14" fill="url(#lunaHairGrad)"/>
          <path d="M56 77 q7 -6 13 1" fill="none" stroke="#F2BEFA" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
          <circle cx="178" cy="82" r="14" fill="url(#lunaHairGrad)"/>
          <path d="M172 77 q7 -6 13 1" fill="none" stroke="#F2BEFA" stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
          <use href="#lunaStar" x="70" y="52" width="16" height="16" fill="url(#lunaStarGrad)"/>
          <use href="#lunaStar" x="156" y="50" width="16" height="16" fill="url(#lunaStarGrad)"/>
        </g>
      </g>
    </g>

    <g class="luna-effects">
      <use class="luna-heart luna-heart--1" href="#lunaHeart" x="42" y="52" width="16" height="16" fill="url(#lunaStarGrad)"/>
      <use class="luna-heart luna-heart--2" href="#lunaHeart" x="192" y="88" width="13" height="13" fill="#F27BA0"/>
      <use class="luna-heart luna-heart--3" href="#lunaHeart" x="168" y="40" width="11" height="11" fill="url(#lunaStarGrad)"/>
      <use class="luna-spark luna-spark--1" href="#lunaStar" x="28" y="108" width="18" height="18" fill="url(#lunaStarGrad)"/>
      <use class="luna-spark luna-spark--2" href="#lunaStar" x="196" y="150" width="14" height="14" fill="url(#lunaStarGrad)"/>
      <use class="luna-spark luna-spark--3" href="#lunaStar" x="44" y="164" width="12" height="12" fill="url(#lunaStarGrad)"/>
    </g>
  </g>

  <!-- ============ SLEEP 睡眠 ============ -->
  <g class="luna-state luna-state--sleep">
    <ellipse class="luna-shadow" cx="112" cy="222" rx="66" ry="10" fill="#8C96E8" opacity="0.14"/>

    <g class="luna-breathe">
      <!-- 铺开的长发：只比头大一圈，两侧带尖角发绺 -->
      <g class="luna-hair-back">
        <path d="M100 102 C72 102 52 122 50 148 C48 172 62 190 84 196 C104 201 128 199 142 190 C156 181 160 164 156 148 C150 122 128 102 100 102 Z" fill="url(#lunaHairGrad)"/>
        <path d="M52 152 C44 172 48 192 62 202 C54 188 52 170 58 154 Z" fill="url(#lunaHairGrad)"/>
        <path d="M152 154 C160 174 156 194 142 204 C150 190 152 172 146 156 Z" fill="url(#lunaHairGrad)"/>
        <path d="M74 122 C86 108 98 102 112 102" fill="none" stroke="url(#lunaHairGradSoft)" stroke-width="5" stroke-linecap="round"/>
      </g>

      <!-- 蜷起的身体：深靛蓝小裙团成一团，藏在头和尾巴之间 -->
      <g class="luna-body">
        <ellipse cx="124" cy="182" rx="58" ry="30" fill="url(#lunaDressGrad)" stroke="#8C96E8" stroke-width="1.2"/>
        <path d="M134 168 q7 -7 14 0 q7 -7 14 0 q7 -7 14 0" fill="none" stroke="#F8F9FC" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M72 200 C94 213 154 213 176 197" fill="none" stroke="#F8F9FC" stroke-width="4" stroke-linecap="round"/>
        <use href="#lunaStar" x="152" y="176" width="15" height="15" fill="url(#lunaStarGrad)"/>
        <path d="M96 175 C104 181 112 184 120 184" fill="none" stroke="#8C96E8" stroke-width="1.2" opacity="0.6"/>
      </g>

      <!-- 大尾巴在前方卷成一圈当抱枕 -->
      <g class="luna-tail luna-tail--sleep">
        <path d="M148 200 C176 202 194 212 186 220 C168 216 142 212 116 212 C90 212 62 214 50 206" fill="none" stroke="url(#lunaTailGrad)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="148" cy="200" r="13" fill="url(#lunaTailGrad)"/>
        <path d="M158 208 C172 212 180 216 176 220" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0.22"/>
        <path d="M132 207 C104 205 76 206 58 205" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity="0.22"/>
      </g>

      <g class="luna-ears">
        <path d="M74 124 C66 112 58 96 56 84 C68 92 82 102 94 110 Z" fill="url(#lunaHairGrad)" stroke="#7B88F0" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M104 108 C116 100 130 94 142 90 C138 104 130 118 124 128 Z" fill="url(#lunaHairGrad)" stroke="#7B88F0" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M77 120 C71 110 64 98 62 89 C71 95 82 103 90 109 Z" fill="#F9D8E6"/>
        <path d="M108 109 C118 104 129 99 137 96 C134 106 127 116 121 123 Z" fill="#F9D8E6"/>
      </g>

      <g class="luna-head">
        <ellipse cx="98" cy="148" rx="40" ry="38" fill="url(#lunaSkinGrad)" stroke="#F3D3C4" stroke-width="1"/>
        <path d="M60 138 C62 112 78 100 98 100 C118 100 134 112 138 138 C130 132 122 138 116 146 C110 134 102 132 98 142 C92 130 84 132 78 146 C72 138 66 132 60 138 Z" fill="url(#lunaHairGrad)"/>
        <path d="M56 140 C50 158 50 176 56 190" fill="none" stroke="url(#lunaHairGrad)" stroke-width="12" stroke-linecap="round"/>

        <g class="luna-eyes luna-eyes--sleep">
          <path d="M74 160 C78 152 86 152 90 160" fill="none" stroke="#2A1B33" stroke-width="3.4" stroke-linecap="round"/>
          <path d="M106 160 C110 152 118 152 122 160" fill="none" stroke="#2A1B33" stroke-width="3.4" stroke-linecap="round"/>
        </g>

        <g class="luna-blush">
          <ellipse cx="70" cy="170" rx="8.5" ry="4.8" fill="#F27BA0" opacity="0.32"/>
          <ellipse cx="126" cy="170" rx="8.5" ry="4.8" fill="#F27BA0" opacity="0.32"/>
        </g>

        <g class="luna-mouth">
          <path d="M94 176 q4 4 8 0" fill="none" stroke="#9A3E5E" stroke-width="2" stroke-linecap="round"/>
        </g>

        <g class="luna-buns">
          <circle cx="62" cy="142" r="11" fill="url(#lunaHairGrad)"/>
          <use href="#lunaStar" x="126" y="118" width="15" height="15" fill="url(#lunaStarGrad)"/>
        </g>
      </g>
    </g>

    <g class="luna-effects luna-effects--sleep">
      <text class="luna-z luna-z--1" x="160" y="112" font-size="22" font-weight="700" font-family="system-ui, sans-serif" fill="#C79BFF">Z</text>
      <text class="luna-z luna-z--2" x="178" y="92" font-size="16" font-weight="700" font-family="system-ui, sans-serif" fill="#C79BFF">z</text>
      <text class="luna-z luna-z--3" x="190" y="76" font-size="12" font-weight="700" font-family="system-ui, sans-serif" fill="#C79BFF">z</text>
      <use class="luna-spark luna-spark--1" href="#lunaStar" x="32" y="150" width="14" height="14" fill="url(#lunaStarGrad)"/>
    </g>
  </g>
</svg>
`.trim();

/* --------------------------------------------------------------------------
   状态
   -------------------------------------------------------------------------- */

let container = null;
let mood = MOOD.IDLE;
let happyTimer = null;

function isValidMood(value) {
  return value === MOOD.IDLE || value === MOOD.HAPPY || value === MOOD.SLEEP;
}

function clearHappyTimer() {
  if (happyTimer !== null) {
    clearTimeout(happyTimer);
    happyTimer = null;
  }
}

function applyMood(next) {
  const safe = isValidMood(next) ? next : MOOD.IDLE;
  mood = safe;
  if (container) {
    container.dataset.mood = safe;
    // 造型切换后重挂动画：同名字符串不会重启 CSS 动画，故按状态派生 animation-name
    container.dataset.animPhase = safe === MOOD.HAPPY ? 'happy' : safe === MOOD.SLEEP ? 'sleep' : 'idle';
  }
  return mood;
}

/** 直接设定造型，返回实际生效值 */
export function setMood(next) {
  clearHappyTimer();
  return applyMood(next);
}

/** 临时开心：非睡眠状态下点击宠物触发 */
export function playHappy() {
  if (!container || mood === MOOD.SLEEP) return false;
  clearHappyTimer();
  applyMood(MOOD.HAPPY);
  happyTimer = setTimeout(() => {
    happyTimer = null;
    if (mood === MOOD.HAPPY) {
      applyMood(MOOD.IDLE);
    }
  }, PET_CONFIG.happyDurationMs);
  return true;
}

/** 订阅外部情绪事件（来自 ui.js 的休眠状态机） */
function handleMoodChange(payload) {
  const state = payload && typeof payload === 'object' ? payload.state : null;
  if (state === 'SLEEP') {
    clearHappyTimer();
    applyMood(MOOD.SLEEP);
    return;
  }
  if (state === 'IDLE') {
    clearHappyTimer();
    applyMood(MOOD.IDLE);
  }
}

function handlePointerUp(event) {
  // 轻点预览：不拦截按钮等其它交互，仅响应宠物容器自身
  if (event && event.target && !container.contains(event.target)) return;
  playHappy();
}

function mount() {
  if (container) return true;
  container = document.getElementById(CONTAINER_ID);
  if (!container) {
    console.warn('[pet] 未找到宠物容器 #' + CONTAINER_ID);
    return false;
  }

  if (PET_CONFIG.renderMode === 'svg') {
    container.innerHTML = LUNA_SVG;
  } else {
    // 预留位图渲染模式：暂无素材，保持空容器并提示
    container.innerHTML = '';
    console.info('[pet] renderMode=' + PET_CONFIG.renderMode + ' 暂未提供素材');
  }

  applyMood(MOOD.IDLE);
  return true;
}

/** 初始化宠物模块：挂载造型 + 绑定事件 */
export function initPet() {
  if (!mount()) return false;

  eventBus.on('pet:mood-change', handleMoodChange);
  container.addEventListener('click', handlePointerUp);

  return true;
}

export default { MOOD, initPet, setMood, playHappy };
