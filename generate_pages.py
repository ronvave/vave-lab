import os

HEADER = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title} — Prof. Ron Vave | UH Mānoa</title>
  <meta name="description" content="{description}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,600&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="css/tokens.css" />
  <link rel="stylesheet" href="css/base.css" />
  <link rel="stylesheet" href="css/animations.css" />
</head>
<body>

<header class="site-header" role="banner">
  <div class="container">
    <div class="nav-inner">
      <a href="index.html" class="nav-logo" aria-label="Vave Lab home">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
          <rect width="36" height="36" rx="10" fill="currentColor" opacity="0.12"/>
          <path d="M6 22 Q10 14 14 22 Q18 30 22 22 Q26 14 30 22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <path d="M12 10 L18 20 L24 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
        Prof. Ron Vave
      </a>
      <nav aria-label="Main navigation">
        <ul class="nav-links" role="list">
          <li><a href="index.html">Home</a></li>
          <li><a href="research.html"{r_active}>Research</a></li>
          <li><a href="publications.html"{p_active}>Publications</a></li>
          <li><a href="supervision.html"{sv_active}>Supervision</a></li>
          <li><a href="teaching.html"{t_active}>Teaching</a></li>
          <li><a href="service.html"{se_active}>Service</a></li>
          <li><a href="media.html"{m_active}>Media</a></li>
        </ul>
      </nav>
      <div class="nav-actions">
        <button class="theme-toggle" data-theme-toggle aria-label="Toggle dark mode"></button>
        <button class="nav-hamburger" aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <div class="mobile-menu" id="mobile-menu" role="navigation" aria-label="Mobile navigation">
      <a href="index.html">Home</a>
      <a href="research.html">Research</a>
      <a href="publications.html">Publications</a>
      <a href="supervision.html">Supervision</a>
      <a href="teaching.html">Teaching</a>
      <a href="service.html">Service</a>
      <a href="media.html">Media</a>
    </div>
  </div>
</header>
'''

BANNER = '''
<section class="page-banner" aria-label="Page header">
  <div class="container page-banner__inner">
    <p class="page-banner__eyebrow">{eyebrow}</p>
    <h1 class="page-banner__title">{page_title}</h1>
  </div>
</section>
'''

FOOTER = '''
<footer class="site-footer" role="contentinfo">
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
          University of Hawaiʻi at Mānoa<br>
          1890 East-West Road, Moore Hall 214<br>
          Honolulu, Hawaiʻi, U.S.A.<br><br>
          Office: <a href="tel:+18089560229">(808) 956-0229</a><br>
          Email: <a href="mailto:ronvave@hawaii.edu">ronvave@hawaii.edu</a>
        </address>
      </div>
    </div>
    <div class="footer-bottom">
      <p class="footer-bottom__copy">&copy; 2026 Ron Vave &middot; University of Hawaiʻi at Mānoa</p>
      <a href="https://hawaii.edu/cpis/people/core-faculty/ron-vave/" target="_blank" rel="noopener" style="font-size:var(--text-xs);color:var(--color-primary-highlight);opacity:0.7;text-decoration:none;">UH Faculty Profile &nearr;</a>
    </div>
  </div>
</footer>
<script src="js/main.js"></script>
</body>
</html>
'''

def page(filename, title, description, eyebrow, page_title, body, active_page=''):
    actives = {k: '' for k in ['r','p','sv','t','se','m']}
    if active_page in actives:
        actives[active_page] = ' class="active"'
    header = HEADER.format(
        title=title, description=description,
        r_active=actives['r'], p_active=actives['p'],
        sv_active=actives['sv'], t_active=actives['t'],
        se_active=actives['se'], m_active=actives['m']
    )
    banner = BANNER.format(eyebrow=eyebrow, page_title=page_title)
    content = header + banner + body + FOOTER
    with open(f'/home/user/workspace/vave-lab/{filename}', 'w') as f:
        f.write(content)
    print(f'Wrote {filename}')

# ─────────────────────────────────────────────
# PUBLICATIONS
# ─────────────────────────────────────────────
pub_body = '''
<main>
<section class="section">
  <div class="container container--narrow">

    <div class="reveal mb-8">
      <p class="section__label">Peer-Reviewed</p>
      <h2 class="section__title">Journal Articles</h2>
      <div class="divider"></div>
    </div>

    <ul class="pub-list" role="list">
      <li class="pub-item reveal">
        <p class="pub-year">2025</p>
        <p class="pub-title"><a href="https://doi.org/10.1071/PC25011" target="_blank" rel="noopener">Increasing Pacific Islander research and authorship in the academic literature</a></p>
        <p class="pub-authors"><strong>Mangubhai, S., Vave, R.</strong>, Begg, S.S., Chung, M., Dileqa, S.V., Golbuu, Y., Gomese, C., Kant, R., Kitolelei, S., Ram, R., Thomas, N., Varea, R., &amp; Whiteside, A.</p>
        <p class="pub-journal">Pacific Conservation Biology, 31(4)</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2024</p>
        <p class="pub-title"><a href="https://doi.org/10.1111/cobi.14403" target="_blank" rel="noopener">Cultural ecosystem services and the conservation challenges for an Indigenous people's aquatic protected area practice</a></p>
        <p class="pub-authors"><strong>Vave, R.</strong>, Friedlander, A.M., Kittinger, J.N., &amp; Ticktin, T.</p>
        <p class="pub-journal">Conservation Biology, 38(6), e14403</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2024</p>
        <p class="pub-title"><a href="https://doi.org/10.1016/j.ecoser.2024.101661" target="_blank" rel="noopener">Impacts of commercial and subsistence fishing on marine and cultural ecosystem services important to the wellbeing of an Indigenous community in Hawaiʻi</a></p>
        <p class="pub-authors"><strong>Vave, R.</strong>, Heck, N., Narayan, S., Carrizales, S., Kenison, D., &amp; Paytan, A.</p>
        <p class="pub-journal">Ecosystem Services, 69, 101661</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2023</p>
        <p class="pub-title"><a href="https://doi.org/10.1007/s40152-023-00318-0" target="_blank" rel="noopener">History matters: societal acceptance of deep-sea mining and incipient conflicts in Papua New Guinea</a></p>
        <p class="pub-authors">van Putten, E.I., Aswani, S., Boonstra, W.J., De la Cruz-Modino, R., Das, J., Glaser, M., Heck, N., Narayan, S., Paytan, A., Selim, S., &amp; <strong>Vave, R.</strong></p>
        <p class="pub-journal">Maritime Studies, 22(3), 32</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2023</p>
        <p class="pub-title"><a href="https://doi.org/10.1016/j.wds.2023.100063" target="_blank" rel="noopener">Balancing culture and survival: an urban-rural socioeconomic assessment of indigenous Fijian funerals in Fiji</a></p>
        <p class="pub-authors"><strong>Vave, R.</strong>, Burnett, K., &amp; Friedlander, A.M.</p>
        <p class="pub-journal">World Development Sustainability, 2, 100063</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2022</p>
        <p class="pub-title"><a href="https://doi.org/10.1007/s13280-021-01620-z" target="_blank" rel="noopener">Five culturally protected water body practices in Fiji: Current status and contemporary displacement challenges</a></p>
        <p class="pub-authors"><strong>Vave, R.</strong></p>
        <p class="pub-journal">Ambio, 51(4), 1001–1013</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2021</p>
        <p class="pub-title"><a href="https://doi.org/10.1177/10105395211005921" target="_blank" rel="noopener">Urban-Rural Compliance Variability to COVID-19 Restrictions of Indigenous Fijian (iTaukei) Funerals in Fiji</a></p>
        <p class="pub-authors"><strong>Vave, R.</strong></p>
        <p class="pub-journal">Asia Pacific Journal of Public Health, 33(6–7), 767–774</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2020</p>
        <p class="pub-title"><a href="https://doi.org/10.1007/s11625-020-00822-w" target="_blank" rel="noopener">Creating a space for place and multidimensional well-being: lessons learned from localizing the SDGs</a></p>
        <p class="pub-authors">Sterling, E.J., Pascua, P., Sigouin, A., …, <strong>Vave, R.</strong>, et al.</p>
        <p class="pub-journal">Sustainability Science, 15(4), 1129–1147</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2017</p>
        <p class="pub-title"><a href="https://doi.org/10.1038/s41559-017-0349-6" target="_blank" rel="noopener">Biocultural approaches to well-being and sustainability indicators across scales</a></p>
        <p class="pub-authors">Sterling, E.J., Filardi, C., Toomey, A., …, <strong>Vave, R.</strong>, et al.</p>
        <p class="pub-journal">Nature Ecology and Evolution, 1(12)</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2017</p>
        <p class="pub-title"><a href="https://www.ecologyandsociety.org/vol22/iss3/art9/" target="_blank" rel="noopener">How small communities respond to environmental change: patterns from tropical to polar ecosystems</a></p>
        <p class="pub-authors">Huntington, H.P., Begossi, A., Fox Gearheard, S., …, <strong>Vave, R.</strong>, et al.</p>
        <p class="pub-journal">Ecology and Society, 22(3), Article 9</p>
      </li>
      <li class="pub-item reveal">
        <p class="pub-year">2016</p>
        <p class="pub-title"><a href="https://doi.org/10.1071/PC15051" target="_blank" rel="noopener">Indicators of herbivorous fish biomass in community-based marine management areas in Fiji</a></p>
        <p class="pub-authors">Albert, S., Tawake, A., <strong>Vave, R.</strong>, Fisher, P., &amp; Grinham, A.</p>
        <p class="pub-journal">Pacific Conservation Biology, 22(1), 20–28</p>
      </li>
    </ul>

  </div>
</section>

<section class="section section--alt">
  <div class="container container--narrow">
    <div class="reveal mb-8">
      <p class="section__label">Books &amp; Reports</p>
      <h2 class="section__title">Book Chapters &amp; Reports</h2>
      <div class="divider"></div>
    </div>

    <ul class="pub-list" role="list">
      <li class="pub-item reveal" style="border-left-color:var(--color-accent);">
        <p class="pub-year" style="color:var(--color-accent)">2024 — Chapter</p>
        <p class="pub-title"><a href="https://www.usp.ac.fj/pace-sd/projects/pocca/pocca-outputs/volume-1" target="_blank" rel="noopener">Chapter 7: Solwara, Moana, Ocean, and local communities — The social, cultural and economic connections</a></p>
        <p class="pub-authors">Veitayaki, J., Huffer, E., Kensen, M., Kitolelei, S., <strong>Vave, R.</strong>, Vunibola, S., Young, L.</p>
      </li>
      <li class="pub-item reveal" style="border-left-color:var(--color-accent);">
        <p class="pub-year" style="color:var(--color-accent)">2009 — Chapter</p>
        <p class="pub-title">Socioeconomic conditions along the world's tropical coasts: 2008</p>
        <p class="pub-authors">Loper, C., Pomeroy, R., Hoon, V., McConney, P., Pena, M., Sanders, A., Sriskanthan, G., Vergara, S., …, <strong>Vave, R.</strong>, Vieux, C., and Wanyoni, I.</p>
      </li>
      <li class="pub-item reveal" style="border-left-color:var(--color-accent);">
        <p class="pub-year" style="color:var(--color-accent)">2005 — Chapter</p>
        <p class="pub-title">Addressing human factors in fisheries development and regulatory processes</p>
        <p class="pub-authors">Veitayaki, J., Tawake, A., Bogiva, A., Meo, S., Ravula, N., <strong>Vave, R.</strong>, and Fong, P.S.</p>
      </li>
      <li class="pub-item reveal" style="border-left-color:var(--color-accent);">
        <p class="pub-year" style="color:var(--color-accent)">2025 — Report</p>
        <p class="pub-title"><a href="https://oceandefendersproject.org/project-publications/ocean-defenders-protectors-of-our-ocean-environment-and-human-rights/" target="_blank" rel="noopener">Ocean Defenders: Protectors of our ocean environment and human rights</a></p>
        <p class="pub-authors">The Ocean Defenders Project. The Peopled Seas Initiative, Vancouver, Canada.</p>
      </li>
    </ul>
  </div>
</section>
</main>
'''

page('publications.html',
     'Publications',
     'Peer-reviewed journal articles, book chapters, and reports by Prof. Ron Vave on ocean governance, cultural ecosystem services, indigenous Fijian funerals, and Pacific marine management.',
     'Vave Lab · Scholarship',
     'Publications',
     pub_body, 'p')

print("Publications done")
