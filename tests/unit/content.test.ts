import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractResources, isMoodlePage } from '../../src/content/extractor';

describe('content extractor', () => {
  it('should detect Moodle page via selectors', () => {
    const dom = new JSDOM(`<body class="pagelayout-course"><div id="page"></div></body>`);
    expect(isMoodlePage(dom.window.document)).toBe(true);
  });

  it('should extract resources with section path', () => {
    const html = `
      <body class="pagelayout-course">
        <div id="page-header"><h1>Course A</h1></div>
        <div class="course-content">
          <li class="section">
            <h3 class="sectionname">Week 1</h3>
            <div class="activity">
              <a class="aalink" href="https://elearning.example.edu/pluginfile.php/123/mod_resource/content/1/slides.pdf">Slides</a>
            </div>
          </li>
        </div>
      </body>
    `;
    const dom = new JSDOM(html, { url: 'https://elearning.example.edu/course/view.php?id=1' });
    const res = extractResources(dom.window.document);
    expect(res.length).toBe(1);
    const first = res[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.name).toBe('Slides');
    expect(first.fileType).toBe('pdf');
    expect(first.path).toContain('Course A');
    expect(first.path).toContain('Week 1');
  });
});
