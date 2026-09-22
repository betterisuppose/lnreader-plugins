import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

/**
 * Chosozo – AI translation site for Re:Zero web novel
 * https://chosozo.com/
 *
 * Uses the site's public Supabase REST API (anon key, same as the website).
 */

const SUPABASE_URL = 'https://wfzijyiaezndyjqoecbb.supabase.co/rest/v1';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmemlqeWlhZXpuZHlqcW9lY2JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDYzNjIsImV4cCI6MjA5NzcyMjM2Mn0.4e_SOjfcotKGiKcTUZL_il4ZkUvWg_up4HfVU1ZjAeU';

const NOVEL_SLUG = 're-zero';
const NOVEL_PATH = '/novel/re-zero';

interface ChapterRow {
  id: number;
  title: string;
  summary?: string | null;
  arc_number?: number | null;
  chapter_number?: number | null;
  slug: string;
  created_at?: string | null;
  updated_at?: string | null;
  chapter_type?: string | null;
  chapter_subtype?: string | null;
}

interface ParagraphRow {
  paragraph_index: number;
  content: string | null;
}

class ChosozoPlugin implements Plugin.PluginBase {
  id = 'chosozo';
  name = 'Chosozo';
  icon = 'src/en/chosozo/icon.png';
  site = 'https://chosozo.com';
  version = '1.0.0';
  filters = undefined;

  private supabaseHeaders(): HeadersInit {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      'Accept-Profile': 'public',
    };
  }

  private async supabaseGet<T>(pathAndQuery: string): Promise<T> {
    const url = `${SUPABASE_URL}${pathAndQuery}`;
    const res = await fetchApi(url, { headers: this.supabaseHeaders() });
    if (!res.ok) {
      throw new Error(`Chosozo API error ${res.status}: ${url}`);
    }
    return res.json() as Promise<T>;
  }

  private formatChapterName(ch: ChapterRow): string {
    const type = (ch.chapter_type || 'main').toLowerCase();
    const subtype = (ch.chapter_subtype || '').toLowerCase();
    const title = (ch.title || '').trim() || 'Untitled';

    if (type === 'main') {
      const arc = ch.arc_number != null ? `Arc ${ch.arc_number}` : '';
      const num =
        ch.chapter_number != null ? `Chapter ${ch.chapter_number}` : '';
      const prefix = [arc, num].filter(Boolean).join(', ');
      return prefix ? `${prefix}: ${title}` : title;
    }

    // side / misc / interlude / if / ex
    const label =
      subtype === 'interlude'
        ? 'Interlude'
        : subtype === 'if'
          ? 'IF'
          : subtype === 'ex'
            ? 'EX'
            : type === 'side'
              ? 'Side Story'
              : type === 'misc'
                ? 'Misc'
                : type.charAt(0).toUpperCase() + type.slice(1);

    return `${label}: ${title}`;
  }

  private chapterSortKey(ch: ChapterRow): number {
    // Order: main chapters by arc then number, then side/misc by date
    const type = (ch.chapter_type || 'main').toLowerCase();
    if (type === 'main') {
      const arc = ch.arc_number ?? 0;
      const num = ch.chapter_number ?? 0;
      // interludes inside main often have null chapter_number — put after previous
      const sub =
        (ch.chapter_subtype || '').toLowerCase() === 'interlude' ? 0.5 : 0;
      return arc * 10000 + num + sub;
    }
    // non-main: sort after all main using created_at timestamp as secondary
    const t = ch.created_at ? Date.parse(ch.created_at) : 0;
    return 1_000_000 + t / 1e12;
  }

  async popularNovels(
    _pageNo: number,
    _options: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    // Single-novel site
    return [
      {
        name: 'Re:Zero − Starting Life in Another World',
        path: NOVEL_PATH,
        cover: defaultCover,
      },
    ];
  }

  async searchNovels(
    searchTerm: string,
    _pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const q = searchTerm.toLowerCase().trim();
    if (
      !q ||
      're:zero'.includes(q) ||
      'rezero'.includes(q.replace(/[\s\-:]/g, '')) ||
      'starting life in another world'.includes(q) ||
      q.includes('rezero') ||
      q.includes('re:zero') ||
      q.includes('chosozo')
    ) {
      return [
        {
          name: 'Re:Zero − Starting Life in Another World',
          path: NOVEL_PATH,
          cover: defaultCover,
        },
      ];
    }
    return [];
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    if (novelPath !== NOVEL_PATH && !novelPath.includes('re-zero')) {
      // still allow in case path is normalized differently
    }

    const rows = await this.supabaseGet<ChapterRow[]>(
      `/chapters?select=id,title,summary,arc_number,chapter_number,slug,created_at,updated_at,chapter_type,chapter_subtype&novel_slug=eq.${NOVEL_SLUG}&published=eq.true&order=arc_number.asc.nullslast,chapter_number.asc.nullslast,created_at.asc`,
    );

    const sorted = [...rows].sort(
      (a, b) => this.chapterSortKey(a) - this.chapterSortKey(b),
    );

    const chapters: Plugin.ChapterItem[] = sorted.map((ch, index) => {
      const item: Plugin.ChapterItem = {
        name: this.formatChapterName(ch),
        path: `/chapter/${ch.slug}`,
        releaseTime: ch.created_at || undefined,
        chapterNumber: index + 1,
      };
      return item;
    });

    // Prefer a main-arc summary if available
    const summarySource =
      sorted.find(c => c.summary && c.summary.trim().length > 40)?.summary ||
      'AI-translated English web novel chapters of Re:Zero − Starting Life in Another World (original work by Tappei Nagatsuki). Hosted on Chosozo.';

    return {
      path: NOVEL_PATH,
      name: 'Re:Zero − Starting Life in Another World',
      author: 'Tappei Nagatsuki',
      cover: defaultCover,
      genres: 'Fantasy, Isekai, Drama, Psychological',
      status: NovelStatus.Ongoing,
      summary: summarySource.trim(),
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // path is like /chapter/arc-10-chapter-36
    const slug = chapterPath
      .replace(/^\/chapter\//, '')
      .replace(/\/$/, '')
      .trim();

    if (!slug) {
      return '<p>Invalid chapter path.</p>';
    }

    const meta = await this.supabaseGet<ChapterRow[]>(
      `/chapters?select=id,title,slug,arc_number,chapter_number,chapter_type,chapter_subtype&novel_slug=eq.${NOVEL_SLUG}&published=eq.true&slug=eq.${encodeURIComponent(slug)}`,
    );

    if (!meta.length) {
      return '<p>Chapter not found.</p>';
    }

    const chapter = meta[0];
    const paragraphs: ParagraphRow[] = [];
    let offset = 0;
    const limit = 1000;

    // Paginate in case of very long chapters
    for (;;) {
      const batch = await this.supabaseGet<ParagraphRow[]>(
        `/paragraphs?select=paragraph_index,content&chapter_id=eq.${chapter.id}&order=paragraph_index.asc&offset=${offset}&limit=${limit}`,
      );
      paragraphs.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    const parts: string[] = [];

    // Optional header
    const header = this.formatChapterName(chapter);
    parts.push(`<h1>${escapeHtml(header)}</h1>`);

    for (const p of paragraphs) {
      const raw = (p.content ?? '').trim();
      if (!raw) {
        parts.push('<br/>');
        continue;
      }

      // Site uses markers like [[author]] for section breaks
      if (/^\[\[.+\]\]$/.test(raw)) {
        const label = raw.replace(/^\[\[|\]\]$/g, '');
        parts.push(`<hr/><p><em>${escapeHtml(label)}</em></p>`);
        continue;
      }

      // Italic author notes often wrapped in *...*
      let html = escapeHtml(raw);
      html = html.replace(/^\*(.+)\*$/s, '<em>$1</em>');
      // Simple emphasis for remaining single *pairs*
      html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

      parts.push(`<p>${html}</p>`);
    }

    return parts.join('\n');
  }

  resolveUrl = (path: string, _isNovel?: boolean) => {
    if (path.startsWith('http')) return path;
    return this.site + (path.startsWith('/') ? path : `/${path}`);
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default new ChosozoPlugin();
