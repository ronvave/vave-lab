import base64, os, re

def encode(path):
    with open(path, 'rb') as f:
        return 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode('utf-8')

portrait_b64 = encode('/home/user/workspace/vave-lab/img/ron-vave-portrait.jpg')

def nav(active=''):
    pages = [
        ('index.html','Home','home'),
        ('research.html','Research','research'),
        ('publications.html','Publications','publications'),
        ('supervision.html','Supervision','supervision'),
        ('teaching.html','Teaching','teaching'),
        ('service.html','Service','service'),
        ('media.html','Media','media'),
    ]
    links = ''.join(f'          <li><a href="{h}"{" class=\"active\"" if k==active else ""}>{l}</a></li>\n' for h,l,k in pages)
    mobile = ''.join(f'      <a href="{h}">{l}</a>' for h,l,k in pages)
    return f'''<header class="site-header" role="banner">
  <div class="container">
    <div class="nav-inner">
      <a href="index.html" class="nav-logo" aria-label="Vave Lab home">
        <img src="{portrait_b64}" alt="Prof. Ron Vave" style="width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:center top;border:2px solid var(--color-primary-highlight);" />
        Prof. Ron Vave
      </a>
      <nav aria-label="Main navigation">
        <ul class="nav-links" role="list">
{links}        </ul>
      </nav>
      <div class="nav-actions">
        <button class="theme-toggle" data-theme-toggle aria-label="Toggle dark mode"></button>
        <button class="nav-hamburger" aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <div class="mobile-menu" id="mobile-menu">
{mobile}
    </div>
  </div>
</header>'''

FOOTER = '''<footer class="site-footer" role="contentinfo">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <p class="footer-brand__name">Prof. Ron Vave</p>
        <p class="footer-brand__tagline">Researching ocean governance, indigenous resource management, and cultural ecosystem services across the Pacific.</p>
        <div class="footer-social">
          <a href="https://scholar.google.com/citations?user=kQp4VUoAAAAJ" target="_blank" rel="noopener">Scholar</a>
          <a href="https://orcid.org/0000-0001-6137-3685" target="_blank" rel="noopener">ORCID</a>
          <a href="https://www.researchgate.net/profile/Ron-Vave" target="_blank" rel="noopener">ResearchGate</a>
          <a href="https://www.linkedin.com/in/ron-vave-041325114/" target="_blank" rel="noopener">LinkedIn</a>
        </div>
      </div>
      <div class="footer-section">
        <h3 class="footer-section__title">Navigate</h3>
        <ul class="footer-nav-list" role="list">
          <li><a href="index.html">Home</a></li>
          <li><a href="research.html">Research</a></li>
          <li><a href="publications.html">Publications</a></li>
          <li><a href="supervision.html">Supervision</a></li>
          <li><a href="teaching.html">Teaching</a></li>
          <li><a href="service.html">Service</a></li>
          <li><a href="media.html">Media</a></li>
        </ul>
      </div>
      <div class="footer-section">
        <h3 class="footer-section__title">Contact</h3>
        <address>
          Department of Pacific Islands Studies<br>
          University of Hawai&#699;i at Manoa<br>
          1890 East-West Road, Moore Hall 214<br>
          Honolulu, Hawai&#699;i, U.S.A.<br><br>
          Office: <a href="tel:+18089560229">(808) 956-0229</a><br>
          Email: <a href="mailto:ronvave@hawaii.edu">ronvave@hawaii.edu</a>
        </address>
      </div>
    </div>
    <div class="footer-bottom">
      <p class="footer-bottom__copy">&copy; 2026 Ron Vave &middot; University of Hawai&#699;i at Manoa</p>
      <a href="https://hawaii.edu/cpis/people/core-faculty/ron-vave/" target="_blank" rel="noopener" style="font-size:var(--text-xs);color:var(--color-primary-highlight);opacity:0.7;text-decoration:none;">UH Faculty Profile</a>
    </div>
  </div>
</footer>
<script src="js/main.js"></script>
</body>
</html>'''

def head(title, desc):
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title} &mdash; Prof. Ron Vave | UH Manoa</title>
  <meta name="description" content="{desc}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,600&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="css/tokens.css" />
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/animations.css" />
</head>
<body>'''

def banner(eyebrow, title):
    return f'''
<section class="page-banner" aria-label="Page header">
  <div class="container page-banner__inner">
    <p class="page-banner__eyebrow">{eyebrow}</p>
    <h1 class="page-banner__title">{title}</h1>
  </div>
</section>'''

def back_link():
    return '''
  <div class="container" style="padding-top:var(--space-8);">
    <a href="index.html#areas-heading" style="display:inline-flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);font-weight:600;color:var(--color-primary);text-decoration:none;font-family:var(--font-body);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      Back to Research &amp; Methods
    </a>
  </div>'''

# ─── 1. ECOLOGICAL SURVEYS ─────────────────────────────────────────────────
eco_body = '''<main>
  ''' + back_link() + '''
  <section class="section">
    <div class="container">
      <div class="section-heading-bar reveal mb-8">
        <p class="section__label">Field Research</p>
        <h2 class="section__title">Ecological Surveys</h2>
        <div class="divider"></div>
      </div>

      <div class="two-col reveal" style="align-items:start;gap:clamp(var(--space-10),6vw,var(--space-20));">
        <div>
          <p style="font-size:var(--text-base);line-height:1.8;color:var(--color-text);margin-bottom:var(--space-6);">
            Diver-operated video (DOV) methodology is used to assess fish behavioral change in funerary protected areas and culturally managed marine sites. This work connects traditional governance practices directly to measurable ecological outcomes across the Pacific.
          </p>
          <p style="font-size:var(--text-base);line-height:1.8;color:var(--color-text);">
            Logged over <strong>1,000 research-associated SCUBA dives</strong> primarily focused on benthic assessments as part of biodiversity surveys of reef health, including Environmental Impact Assessments (EIAs).
          </p>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-xl);padding:var(--space-8);">
          <p class="section__label" style="margin-bottom:var(--space-5);">Key Activities</p>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-4);" role="list">
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              <span><a href="https://ias.usp.ac.fj/coral-recruitment-during-a-post-bleaching-recover-period/" target="_blank" rel="noopener" style="color:var(--color-primary);">Coral settlement studies</a> (Masters research at the University of the South Pacific, Fiji)</span>
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Reef fish and invertebrate assessments
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Testing and training on early versions of <strong>Coral Finder</strong> (developer: Russell Kelley)
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Collection of ascidian specimens of <em>Lissoclinum patella</em> from Fiji and the Solomon Islands for USP&rsquo;s IAS Natural Products anti-malarial research
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Elucidating food fish behavioral change in Fiji&rsquo;s Funerary Protected Areas (FPAs) using DOV methodology
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--alt">
    <div class="container">
      <div class="section-heading-bar reveal mb-8">
        <p class="section__label">Current Work</p>
        <h2 class="section__title">Active Ecological Research</h2>
        <div class="divider"></div>
      </div>
      <div class="research-grid">
        <article class="research-card reveal">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <h3 class="research-card__title">Funerary Protected Areas (FPAs)</h3>
          <p class="research-card__desc">Using DOV to measure fish behavioral change inside culturally-enforced closures during iTaukei funeral periods in Fiji — testing whether traditional taboos produce measurable ecological outcomes.</p>
          <p class="research-card__region">Fiji</p>
        </article>
        <article class="research-card reveal reveal-delay-1">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <h3 class="research-card__title">Culturally Protected Water Bodies (CPWBs)</h3>
          <p class="research-card__desc">Documenting marine biodiversity and fish assemblages within indigenous culturally protected water body sites across the Pacific region.</p>
          <p class="research-card__region">Pacific Region</p>
        </article>
        <article class="research-card reveal reveal-delay-2">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </div>
          <h3 class="research-card__title">Reef Passage Valuation</h3>
          <p class="research-card__desc">Ecological assessment of reef passage systems across Fiji and New Caledonia as part of the <a href="https://socpacific.link" target="_blank" rel="noopener" style="color:var(--color-primary);">South Pacific project</a>.</p>
          <p class="research-card__region">Fiji &amp; New Caledonia</p>
        </article>
      </div>
    </div>
  </section>
</main>'''

with open('/home/user/workspace/vave-lab/ecological-surveys.html', 'w') as f:
    f.write(head('Ecological Surveys', 'Ron Vave\'s ecological survey work including 1,000+ SCUBA dives, DOV methodology, coral settlement studies, and reef fish assessments across the Pacific.') +
            nav('research') + banner('Vave Lab &middot; Field Research', 'Ecological Surveys') + eco_body + FOOTER)
print("✓ ecological-surveys.html")

# ─── 2. COMMUNITY WORKSHOPS & SURVEYS ─────────────────────────────────────
community_body = '''<main>
  ''' + back_link() + '''
  <section class="section">
    <div class="container">
      <div class="section-heading-bar reveal mb-8">
        <p class="section__label">Participatory Research</p>
        <h2 class="section__title">Community Workshops &amp; Surveys</h2>
        <div class="divider"></div>
      </div>
      <div class="two-col reveal" style="align-items:start;gap:clamp(var(--space-10),6vw,var(--space-20));">
        <div>
          <p style="font-size:var(--text-base);line-height:1.8;color:var(--color-text);margin-bottom:var(--space-6);">
            Ethnographic and participatory research with indigenous and local communities across Oceania, documenting socioecological resilience and traditional knowledge systems. This work places communities at the center of knowledge production.
          </p>
          <p style="font-size:var(--text-base);line-height:1.8;color:var(--color-text);">
            Community workshops and surveys are a core method for understanding how cultural practices, traditional governance, and socioeconomic conditions shape marine resource management outcomes — and for co-producing solutions with the people who manage these resources.
          </p>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-xl);padding:var(--space-8);">
          <p class="section__label" style="margin-bottom:var(--space-5);">Approaches Used</p>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-4);" role="list">
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Semi-structured interviews and focus groups
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Participatory mapping and resource assessments
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Household surveys and socioeconomic assessments
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Community-based monitoring and reporting
            </li>
            <li style="display:flex;align-items:flex-start;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);line-height:1.6;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-primary);border-radius:50%;flex-shrink:0;margin-top:0.4em;"></span>
              Autoethnographic and oral history methods
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--alt">
    <div class="container">
      <div class="section-heading-bar reveal mb-8">
        <p class="section__label">Research Regions</p>
        <h2 class="section__title">Where We Work</h2>
        <div class="divider"></div>
      </div>
      <div class="research-grid">
        <article class="research-card reveal">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <h3 class="research-card__title">Fiji</h3>
          <p class="research-card__desc">Community research in iTaukei villages documenting funeral practices, culturally protected water bodies, and socioecological resilience across rural and urban contexts.</p>
          <p class="research-card__region">Primary Fieldsite</p>
        </article>
        <article class="research-card reveal reveal-delay-1">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <h3 class="research-card__title">Hawaiʻi</h3>
          <p class="research-card__desc">Surveys on marine cultural ecosystem services and the wellbeing of indigenous communities in Hawaiʻi, examining the intersection of fishing, culture, and food security.</p>
          <p class="research-card__region">Active Research</p>
        </article>
        <article class="research-card reveal reveal-delay-2">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
          </div>
          <h3 class="research-card__title">Broader Pacific</h3>
          <p class="research-card__desc">Community engagement across six Indo-Pacific nations through the LMMA Network, including Papua New Guinea, Solomon Islands, Indonesia, and the Philippines.</p>
          <p class="research-card__region">6 Countries</p>
        </article>
      </div>
    </div>
  </section>
</main>'''

with open('/home/user/workspace/vave-lab/community-workshops.html', 'w') as f:
    f.write(head('Community Workshops & Surveys', 'Participatory and ethnographic research with indigenous and local communities across Oceania documenting socioecological resilience and traditional knowledge.') +
            nav('research') + banner('Vave Lab &middot; Participatory Research', 'Community Workshops &amp; Surveys') + community_body + FOOTER)
print("✓ community-workshops.html")

# ─── 3. LMMA NETWORK ──────────────────────────────────────────────────────
lmma_body = '''<main>
  ''' + back_link() + '''
  <section class="section">
    <div class="container">
      <div class="section-heading-bar reveal mb-8">
        <p class="section__label">Conservation Network</p>
        <h2 class="section__title">Locally Managed Marine Area (LMMA) Network</h2>
        <div class="divider"></div>
      </div>
      <div class="two-col reveal" style="align-items:start;gap:clamp(var(--space-10),6vw,var(--space-20));">
        <div>
          <p style="font-size:var(--text-base);line-height:1.8;color:var(--color-text);margin-bottom:var(--space-6);">
            The <a href="https://lmmanetwork.org" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:600;">LMMA Network</a> is a grassroots network dedicated to advancing locally-led natural resource management across the Indo-Pacific.
          </p>
          <p style="font-size:var(--text-base);line-height:1.8;color:var(--color-text);margin-bottom:var(--space-6);">
            Ron worked for <strong>14 years</strong> with the LMMA Network through the University of the South Pacific in Fiji, spanning research and conservation work across <strong>six countries</strong>. This experience forms the foundation of his expertise in community-based fisheries management and indigenous resource governance.
          </p>
          <a href="https://lmmanetwork.org" target="_blank" rel="noopener" class="btn btn--primary" style="display:inline-flex;margin-top:var(--space-4);">Visit LMMA Network &rarr;</a>
        </div>
        <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-xl);padding:var(--space-8);">
          <p class="section__label" style="margin-bottom:var(--space-5);">Countries &amp; Regions</p>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:var(--space-4);" role="list">
            <li style="display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);font-weight:600;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-gold);border-radius:50%;flex-shrink:0;"></span>Fiji
            </li>
            <li style="display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);font-weight:600;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-gold);border-radius:50%;flex-shrink:0;"></span>Federated States of Micronesia
            </li>
            <li style="display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);font-weight:600;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-gold);border-radius:50%;flex-shrink:0;"></span>Papua New Guinea
            </li>
            <li style="display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);font-weight:600;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-gold);border-radius:50%;flex-shrink:0;"></span>Indonesia
            </li>
            <li style="display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);font-weight:600;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-gold);border-radius:50%;flex-shrink:0;"></span>Philippines
            </li>
            <li style="display:flex;align-items:center;gap:var(--space-3);font-size:var(--text-sm);color:var(--color-text);font-weight:600;">
              <span style="width:0.5rem;height:0.5rem;background:var(--color-gold);border-radius:50%;flex-shrink:0;"></span>Solomon Islands
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--alt">
    <div class="container">
      <div class="section-heading-bar reveal mb-8">
        <p class="section__label">Fieldwork</p>
        <h2 class="section__title">LMMA Highlights</h2>
        <div class="divider"></div>
      </div>
      <div class="research-grid">
        <article class="research-card reveal">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <h3 class="research-card__title">Fiji LMMA AGM 2017</h3>
          <p class="research-card__desc">Lessons Learning &amp; Annual General Meeting held at Bua Village, Bua Province, Fiji — 20th&ndash;24th November 2017. Bringing together community practitioners from across the network.</p>
          <p class="research-card__region">Fiji</p>
        </article>
        <article class="research-card reveal reveal-delay-1">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <h3 class="research-card__title">Community-Led Conservation</h3>
          <p class="research-card__desc">Co-producing conservation knowledge with fishing communities — supporting community monitoring, tabu (closure) systems, and adaptive management planning across the Indo-Pacific.</p>
          <p class="research-card__region">Indo-Pacific</p>
        </article>
        <article class="research-card reveal reveal-delay-2">
          <div class="research-card__icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          </div>
          <h3 class="research-card__title">Indicators of Success</h3>
          <p class="research-card__desc">Research on indicators of herbivorous fish biomass in community-based marine management areas in Fiji &mdash; published in <a href="https://doi.org/10.1071/PC15051" target="_blank" rel="noopener" style="color:var(--color-primary);">Pacific Conservation Biology</a>.</p>
          <p class="research-card__region">Fiji</p>
        </article>
      </div>
    </div>
  </section>
</main>'''

with open('/home/user/workspace/vave-lab/lmma-network.html', 'w') as f:
    f.write(head('LMMA Network', '14 years of research and conservation work with the Locally Managed Marine Area (LMMA) Network across six Indo-Pacific countries.') +
            nav('research') + banner('Vave Lab &middot; Conservation Network', 'LMMA Network') + lmma_body + FOOTER)
print("✓ lmma-network.html")

# ─── 4. DATA ANALYSIS & VISUALIZATIONS ────────────────────────────────────
data_body = '''<main>
  ''' + back_link() + '''
  <section class="section">
    <div class="container">
      <div class="section-heading-bar reveal mb-8">
        <p class="section__label">Methods &amp; Tools</p>
        <h2 class="section__title">Data Analysis &amp; Visualization</h2>
        <div class="divider"></div>
      </div>
      <p style="font-size:var(--text-base);line-height:1.8;color:var(--color-text);max-width:68ch;margin-bottom:var(--space-10);" class="reveal">
        Mixed-methods quantitative and qualitative analysis underpins all research in the Vave Lab. A suite of industry-standard tools is used to analyze ecological and social datasets — from reef fish counts to household survey data to deep-sea video footage.
      </p>

      <div class="research-grid">
        <article class="research-card reveal">
          <div class="research-card__icon" style="background:var(--color-primary-highlight);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <h3 class="research-card__title">R Software</h3>
          <p class="research-card__desc">Statistical analysis and data visualization. Used for hierarchical clustering, time series decomposition, correlation analysis, and generating publication-quality figures.</p>
          <p class="research-card__region">Statistical Analysis</p>
        </article>

        <article class="research-card reveal reveal-delay-1">
          <div class="research-card__icon" style="background:var(--color-primary-highlight);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>
          </div>
          <h3 class="research-card__title">QGIS</h3>
          <p class="research-card__desc">Quantum Geographic Information System — used for spatial mapping of marine protected areas, LMMA boundaries, CPWB sites, and community territories across the Pacific.</p>
          <p class="research-card__region">Spatial Mapping</p>
        </article>

        <article class="research-card reveal reveal-delay-2">
          <div class="research-card__icon" style="background:var(--color-primary-highlight);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <h3 class="research-card__title">Qualtrics</h3>
          <p class="research-card__desc">Survey design and data collection platform — used for household surveys, community wellbeing assessments, and socioeconomic data collection across research sites.</p>
          <p class="research-card__region">Survey Research</p>
        </article>

        <article class="research-card reveal">
          <div class="research-card__icon" style="background:var(--color-primary-highlight);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.845v6.31a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/></svg>
          </div>
          <h3 class="research-card__title">TATOR</h3>
          <p class="research-card__desc">Deep-sea video annotation platform — used for taxonomic specimen identification in partnership with National Geographic. Enables detailed marine biodiversity assessment from underwater footage.</p>
          <p class="research-card__region">Video Annotation</p>
        </article>

        <article class="research-card reveal reveal-delay-1">
          <div class="research-card__icon" style="background:var(--color-primary-highlight);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <h3 class="research-card__title">NVivo &amp; MAXQDA</h3>
          <p class="research-card__desc">Qualitative data analysis software — used for thematic coding of interview transcripts, focus group data, and ethnographic field notes from community research.</p>
          <p class="research-card__region">Qualitative Analysis</p>
        </article>

        <article class="research-card reveal reveal-delay-2">
          <div class="research-card__icon" style="background:var(--color-primary-highlight);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
          <h3 class="research-card__title">Adobe Photoshop</h3>
          <p class="research-card__desc">Used for scientific image processing, preparation of figures for publication, and visual documentation of fieldwork and specimen photography.</p>
          <p class="research-card__region">Image Processing</p>
        </article>
      </div>
    </div>
  </section>
</main>'''

with open('/home/user/workspace/vave-lab/data-analysis.html', 'w') as f:
    f.write(head('Data Analysis & Visualization', 'Mixed-methods data analysis tools used in the Vave Lab including R, QGIS, Qualtrics, TATOR, NVivo, MAXQDA, and Adobe Photoshop.') +
            nav('research') + banner('Vave Lab &middot; Methods &amp; Tools', 'Data Analysis &amp; Visualization') + data_body + FOOTER)
print("✓ data-analysis.html")
print("\nAll 4 sub-pages built!")
