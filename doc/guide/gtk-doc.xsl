<?xml version='1.0'?> <!--*- mode: xml -*-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:l="http://docbook.sourceforge.net/xmlns/l10n/1.0"
                exclude-result-prefixes="l"
                version="1.0">

  <!-- import the chunked XSL stylesheet -->
  <!-- http://www.sagehill.net/docbookxsl/Chunking.html says we should use
       "chunkfast.xsl", but I can see a difference -->
  <xsl:import href="http://docbook.sourceforge.net/release/xsl/current/html/chunk.xsl"/>
  <xsl:include href="version-greater-or-equal.xsl"/>

  <xsl:key name="acronym.key"
	   match="glossentry/glossterm"
	   use="."/>
  <xsl:key name="gallery.key"
	   match="para[@role='gallery']/link"
	   use="@linkend"/>

  <!-- change some parameters -->
  <!-- http://docbook.sourceforge.net/release/xsl/current/doc/html/index.html -->
  <xsl:param name="toc.section.depth">4</xsl:param>
  <xsl:param name="generate.section.toc.level" select="3"></xsl:param>
  <xsl:param name="generate.toc">
    book	toc
    chapter toc
    glossary toc
    index toc
    part	toc
    reference toc,title,refsection
    refentry  toc
  </xsl:param>

  <xsl:param name="chunker.output.encoding" select="'UTF-8'"/>
  <xsl:param name="chunker.output.indent" select="'yes'"/>
  <xsl:param name="chunker.output.doctype-public" select="'-//W3C//DTD HTML 4.01 Transitional//EN'"/>
  <xsl:param name="chunk.fast" select="1"/>
  <xsl:param name="chunk.quietly" select="1"/>
  <xsl:param name="chunk.section.depth" select="0"/>
  <xsl:param name="chunk.first.sections" select="1"/>

  <xsl:param name="default.encoding" select="'UTF-8'"/>
  <xsl:param name="chapter.autolabel" select="0"/>
  <xsl:param name="reference.autolabel" select="0"/>
  <xsl:param name="use.id.as.filename" select="1"/>
  <xsl:param name="html.ext" select="'.html'"/>
  <xsl:param name="refentry.generate.name" select="0"/>
  <xsl:param name="refentry.generate.title" select="1"/>
  <!-- don't generate all those link tags (very slow and hardly used)
       it does not show much effect as we have a user.head.content template
  <xsl:param name="html.extra.head.links" select="0" />
   -->

  <!-- use index filtering (if available) -->
  <xsl:param name="index.on.role" select="1"/>

  <!-- display variablelists as tables -->
  <xsl:param name="variablelist.as.table" select="1"/>

  <!-- new things to consider
  <xsl:param name="glossterm.auto.link" select="0"></xsl:param>
  -->

  <!-- this gets set on the command line ... -->
  <xsl:param name="gtkdoc.version" select="''"/>
  <xsl:param name="gtkdoc.bookname" select="''"/>

  <!-- ========================================================= -->

  <!-- l10n is slow, we don't ue it, so we'd like to turn it off
       this atleast avoid the re-evaluation -->
  <xsl:template name="l10n.language">en</xsl:template>

  <xsl:param name="gtkdoc.l10n.xml" select="document('http://docbook.sourceforge.net/release/xsl/current/common/en.xml')"/>

  <xsl:key name="gtkdoc.gentext.key"
	   match="l:gentext[@key]"
	   use="@key"/>
  <xsl:key name="gtkdoc.context.key"
	   match="l:context[@name]"
	   use="@name"/>

  <xsl:template name="gentext">
    <xsl:param name="key" select="local-name(.)"/>

    <xsl:for-each select="$gtkdoc.l10n.xml">
    <xsl:variable name="l10n.gentext" select="key('gtkdoc.gentext.key', $key)"/>

    <xsl:choose>
      <xsl:when test="$l10n.gentext">
        <xsl:value-of select="$l10n.gentext/@text"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:message>
          <xsl:text>No "en" localization of "</xsl:text>
          <xsl:value-of select="$key"/>
          <xsl:text>" exists.</xsl:text>
        </xsl:message>
      </xsl:otherwise>
    </xsl:choose>
    </xsl:for-each>
  </xsl:template>

  <xsl:template name="gentext.dingbat">
    <xsl:param name="dingbat">bullet</xsl:param>

    <xsl:variable name="l10n.dingbat"
                  select="($gtkdoc.l10n.xml/l:l10n/l:dingbat[@key=$dingbat])[1]"/>

    <xsl:choose>
      <xsl:when test="$l10n.dingbat">
        <xsl:value-of select="$l10n.dingbat/@text"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:message>
          <xsl:text>No "en" localization of dingbat </xsl:text>
          <xsl:value-of select="$dingbat"/>
          <xsl:text> exists; using "en".</xsl:text>
        </xsl:message>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="gentext.template">
    <xsl:param name="context" select="'default'"/>
    <xsl:param name="name" select="'default'"/>
    <xsl:param name="origname" select="$name"/>

    <!-- cut leading / if any to avoid one recursion -->
    <xsl:variable name="rname">
      <xsl:choose>
        <xsl:when test="starts-with($name, '/')">
          <xsl:value-of select="substring-after($name, '/')"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:value-of select="$name"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:variable>

    <!-- this is called with context="title|title-numbered|title-unnumbered>
    <xsl:message>
      <xsl:text>context:</xsl:text><xsl:value-of select="$context"/>
      <xsl:text>;name:</xsl:text><xsl:value-of select="$rname"/>
      <xsl:text>;origname:</xsl:text><xsl:value-of select="$origname"/>
    </xsl:message>

    see html/html.xsl:<xsl:template match="*" mode="html.title.attribute">
    -->

    <xsl:for-each select="$gtkdoc.l10n.xml">
    <xsl:variable name="context.node" select="key('gtkdoc.context.key', $context)"/>
    <xsl:variable name="template.node"
                  select="($context.node/l:template[@name=$rname])[1]"/>

    <xsl:choose>
      <xsl:when test="$template.node/@text">
        <xsl:value-of select="$template.node/@text"/>
        <!-- debug
        <xsl:message>
          <xsl:text>=</xsl:text><xsl:value-of select="$template.node/@text"/>
        </xsl:message>
        -->
      </xsl:when>
      <xsl:otherwise>
        <xsl:choose>
          <xsl:when test="contains($rname, '/')">
            <xsl:call-template name="gentext.template">
              <xsl:with-param name="context" select="$context"/>
              <xsl:with-param name="name" select="substring-after($rname, '/')"/>
              <xsl:with-param name="origname" select="$origname"/>
            </xsl:call-template>
          </xsl:when>
        </xsl:choose>
      </xsl:otherwise>
    </xsl:choose>
    </xsl:for-each>
  </xsl:template>

  <!-- silently test whether a gentext template exists -->
  <xsl:template name="gentext.template.exists">
    <xsl:param name="context" select="'default'"/>
    <xsl:param name="name" select="'default'"/>
    <xsl:param name="origname" select="$name"/>

    <xsl:variable name="template">
      <xsl:call-template name="gentext.template">
        <xsl:with-param name="context" select="$context"/>
        <xsl:with-param name="name" select="$name"/>
        <xsl:with-param name="origname" select="$origname"/>
      </xsl:call-template>
    </xsl:variable>

    <xsl:choose>
      <xsl:when test="string-length($template) != 0">1</xsl:when>
      <xsl:otherwise>0</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- shortcut version -->
  <!-- @bug: https://bugzilla.gnome.org/show_bug.cgi?id=617478 -->
  <xsl:template name="generate.html.title"/>
  <!--xsl:template name="generate.html.title">
    <xsl:variable name="has.title.markup">
      <xsl:apply-templates select="." mode="title.markup">
        <xsl:with-param name="verbose" select="0"/>
      </xsl:apply-templates>
    </xsl:variable>
    <xsl:if test="$has.title.markup != '???TITLE???'">
      <xsl:variable name="gentext.title">
        <xsl:apply-templates select="."  mode="object.title.markup.textonly"/>
      </xsl:variable>
      <xsl:choose>
        <xsl:when test="string-length($gentext.title) != 0">
          <xsl:attribute name="title">
            <xsl:value-of select="$gentext.title"/>
          </xsl:attribute>
        </xsl:when>
        <xsl:when test="alt">
          <xsl:attribute name="title">
            <xsl:value-of select="normalize-space(alt)"/>
          </xsl:attribute>
        </xsl:when>
      </xsl:choose>
    </xsl:if>
  </xsl:template-->

  <!-- Generate a title attribute for the context node (e.g. links) -->
  <xsl:template match="*" mode="html.title.attribute">
    <xsl:variable name="has.title.markup">
      <xsl:apply-templates select="." mode="title.markup">
        <xsl:with-param name="verbose" select="0"/>
      </xsl:apply-templates>
    </xsl:variable>
    <xsl:if test="$has.title.markup != '???TITLE???'">
      <xsl:variable name="is.title">
        <xsl:call-template name="gentext.template.exists">
          <xsl:with-param name="context" select="'title'"/>
          <xsl:with-param name="name" select="local-name(.)"/>
          <xsl:with-param name="lang">
            <xsl:call-template name="l10n.language"/>
          </xsl:with-param>
        </xsl:call-template>
      </xsl:variable>

      <xsl:variable name="is.title-numbered">
        <xsl:if test="$is.title = 0">
          <xsl:call-template name="gentext.template.exists">
            <xsl:with-param name="context" select="'title-numbered'"/>
            <xsl:with-param name="name" select="local-name(.)"/>
            <xsl:with-param name="lang">
              <xsl:call-template name="l10n.language"/>
            </xsl:with-param>
          </xsl:call-template>
        </xsl:if>
      </xsl:variable>


      <xsl:variable name="is.title-unnumbered">
        <xsl:if test="$is.title = 0 and $is.title-numbered = 0">
          <xsl:call-template name="gentext.template.exists">
            <xsl:with-param name="context" select="'title-unnumbered'"/>
            <xsl:with-param name="name" select="local-name(.)"/>
            <xsl:with-param name="lang">
              <xsl:call-template name="l10n.language"/>
            </xsl:with-param>
          </xsl:call-template>
        </xsl:if>
      </xsl:variable>

      <xsl:variable name="gentext.title">
        <xsl:if test="$is.title != 0 or
                      $is.title-numbered != 0 or
                      $is.title-unnumbered != 0">
          <xsl:apply-templates select="."
                               mode="object.title.markup.textonly"/>
        </xsl:if>
      </xsl:variable>

      <xsl:choose>
        <xsl:when test="string-length($gentext.title) != 0">
          <xsl:attribute name="title">
            <xsl:value-of select="$gentext.title"/>
          </xsl:attribute>
        </xsl:when>
        <xsl:when test="alt">
          <xsl:attribute name="title">
            <xsl:value-of select="normalize-space(alt)"/>
          </xsl:attribute>
        </xsl:when>
      </xsl:choose>
    </xsl:if>
  </xsl:template>




  <!-- ========================================================= -->
  <!-- template to create the index.sgml anchor index -->

  <xsl:template match="book|article">
    <xsl:variable name="tooldver">
      <xsl:call-template name="version-greater-or-equal">
        <xsl:with-param name="ver1" select="$VERSION" />
        <xsl:with-param name="ver2">1.36</xsl:with-param>
      </xsl:call-template>
    </xsl:variable>
    <xsl:if test="$tooldver = 0">
      <xsl:message terminate="yes">
FATAL-ERROR: You need the DocBook XSL Stylesheets version 1.36 or higher
to build the documentation.
Get a newer version at http://docbook.sourceforge.net/projects/xsl/
      </xsl:message>
    </xsl:if>
    <xsl:apply-imports/>

    <!-- generate the index.sgml href index -->
    <xsl:call-template name="generate.index"/>
  </xsl:template>

  <xsl:template name="generate.index">
    <xsl:call-template name="write.text.chunk">
      <xsl:with-param name="filename" select="'index.sgml'"/>
      <xsl:with-param name="content">
        <xsl:apply-templates select="/book/bookinfo/releaseinfo/ulink"
                             mode="generate.index.mode"/>
        <!-- check all anchor and refentry elements -->
	<!--
	    The obvious way to write this is //anchor|//refentry|etc...
	    The obvious way is slow because it causes multiple traversals
	    in libxslt. This take about half the time.
	-->
	<xsl:apply-templates select="//*[name()='anchor' or name()='refentry' or name()='refsect1' or
				         name() = 'refsect2' or name()='refsynopsisdiv' or
					 name()='varlistentry']"
                             mode="generate.index.mode"/>
      </xsl:with-param>
      <xsl:with-param name="default.encoding" select="'UTF-8'"/>
      <xsl:with-param name="chunker.output.indent" select="'no'"/>
    </xsl:call-template>
  </xsl:template>

  <xsl:template match="*" mode="generate.index.mode">
    <xsl:if test="not(@href) and count(@id) > 0">
      <xsl:text>&lt;ANCHOR id=&quot;</xsl:text>
      <xsl:value-of select="@id"/>
      <xsl:text>&quot; href=&quot;</xsl:text>
        <xsl:if test="$gtkdoc.bookname">
          <xsl:value-of select="$gtkdoc.bookname"/>
          <xsl:text>/</xsl:text>
        </xsl:if>
        <xsl:call-template name="href.target"/>
        <xsl:text>&quot;&gt;&#10;</xsl:text>
    </xsl:if>
  </xsl:template>

  <xsl:template match="/book/bookinfo/releaseinfo/ulink" mode="generate.index.mode">
    <xsl:if test="@role='online-location'">
      <xsl:text>&lt;ONLINE href=&quot;</xsl:text>
      <xsl:value-of select="@url"/>
      <xsl:text>&quot;&gt;&#10;</xsl:text>
    </xsl:if>
  </xsl:template>

  <!-- ========================================================= -->
  <!-- template to output gtkdoclink elements for the unknown targets -->

  <xsl:template match="link">
    <xsl:choose>
      <xsl:when test="id(@linkend)">
        <xsl:apply-imports/>
      </xsl:when>
      <xsl:otherwise>
        <GTKDOCLINK HREF="{@linkend}">
          <xsl:apply-templates/>
        </GTKDOCLINK>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- ========================================================= -->
  <!-- Below are the visual portions of the stylesheet.  They provide
       the normal gtk-doc output style. -->

  <xsl:param name="shade.verbatim" select="0"/>
  <xsl:param name="refentry.separator" select="0"/>

  <xsl:template match="refsect2">
    <xsl:if test="preceding-sibling::refsect2">
      <hr/>
    </xsl:if>
    <xsl:apply-imports/>
  </xsl:template>

  <xsl:template name="user.head.content">
    <xsl:if test="$gtkdoc.version">
      <meta name="generator" content="GTK-Doc V{$gtkdoc.version} (XML mode)"/>
    </xsl:if>
    <link rel="stylesheet" href="style.css" type="text/css"/>
  </xsl:template>

  <xsl:template name="user.footer.content">
    <div class="footer">
      <hr />
      <xsl:choose>
        <xsl:when test="$gtkdoc.version">
        </xsl:when>
        <xsl:otherwise>
        </xsl:otherwise>
      </xsl:choose>
    </div>
  </xsl:template>

  <xsl:template match="title" mode="book.titlepage.recto.mode">
    <table class="navigation" id="top" width="100%"
           cellpadding="2" cellspacing="0">
      <tr>
        <th valign="middle">
          <p class="{name(.)}">
            <xsl:value-of select="."/>
          </p>
        </th>
      </tr>
    </table>
  </xsl:template>

  <xsl:template name="header.navigation">
    <xsl:param name="prev" select="/foo"/>
    <xsl:param name="next" select="/foo"/>
    <xsl:variable name="home" select="/*[1]"/>
    <xsl:variable name="up" select="parent::*"/>
    <xsl:variable name="refsections" select="./refsect1[@role]"/>
    <xsl:variable name="glssections" select="./glossdiv/title"/>
    <xsl:variable name="idxsections" select="./indexdiv/indexdiv/title"/>
    <xsl:variable name="section_id" select="./@id"/>
    <xsl:variable name="sect_object_hierarchy" select="./refsect1[@role='object_hierarchy']"/>
    <xsl:variable name="sect_impl_interfaces" select="./refsect1[@role='impl_interfaces']"/>
    <xsl:variable name="sect_prerequisites" select="./refsect1[@role='prerequisites']"/>
    <xsl:variable name="sect_derived_interfaces" select="./refsect1[@role='derived_interfaces']"/>
    <xsl:variable name="sect_implementations" select="./refsect1[@role='implementations']"/>
    <xsl:variable name="sect_properties" select="./refsect1[@role='properties']"/>
    <xsl:variable name="sect_child_properties" select="./refsect1[@role='child_properties']"/>
    <xsl:variable name="sect_style_properties" select="./refsect1[@role='style_properties']"/>
    <xsl:variable name="sect_signal_proto" select="./refsect1[@role='signal_proto']"/>
    <xsl:variable name="sect_desc" select="./refsect1[@role='desc']"/>
    <xsl:variable name="sect_synopsis" select="./refsynopsisdiv[@role='synopsis']"/>
    <!--
    <xsl:variable name="sect_details" select="./refsect1[@id='details']"/>
    <xsl:variable name="sect_property_details" select="./refsect1[@id='property_details']"/>
    <xsl:variable name="sect_child_property_details" select="./refsect1[@id='child_property_details']"/>
    <xsl:variable name="sect_style_property_details" select="./refsect1[@id='style_property_details']"/>
    <xsl:variable name="sect_signals" select="./refsect1[@id='signals']"/>
    -->

    <xsl:if test="$suppress.navigation = '0' and $home != .">
      <table class="navigation" id="top" width="100%"
             summary = "Navigation header" cellpadding="2" cellspacing="2">
        <tr valign="middle">
          <xsl:choose>
            <xsl:when test="count($prev) > 0">
              <td>
                <a accesskey="p">
                  <xsl:attribute name="href">
                    <xsl:call-template name="href.target">
                      <xsl:with-param name="object" select="$prev"/>
                    </xsl:call-template>
                  </xsl:attribute>
                  <img src="left.png" width="24" height="24" border="0">
                    <xsl:attribute name="alt">
                      <xsl:call-template name="gentext">
                        <xsl:with-param name="key">nav-prev</xsl:with-param>
                      </xsl:call-template>
                    </xsl:attribute>
                  </img>
                </a>
              </td>
            </xsl:when>
            <xsl:otherwise>
              <td>&#160;</td>
            </xsl:otherwise>
          </xsl:choose>
          <xsl:choose>
            <xsl:when test="count($up) > 0 and $up != $home">
              <td>
                <a accesskey="u">
                  <xsl:attribute name="href">
                    <xsl:call-template name="href.target">
                      <xsl:with-param name="object" select="$up"/>
                    </xsl:call-template>
                  </xsl:attribute>
                  <img src="up.png" width="24" height="24" border="0">
                    <xsl:attribute name="alt">
                      <xsl:call-template name="gentext">
                        <xsl:with-param name="key">nav-up</xsl:with-param>
                      </xsl:call-template>
                    </xsl:attribute>
                  </img>
                </a>
              </td>
            </xsl:when>
            <xsl:otherwise>
              <td>&#160;</td>
            </xsl:otherwise>
          </xsl:choose>
          <xsl:choose>
            <xsl:when test="$home != .">
              <td>
                <a accesskey="h">
                  <xsl:attribute name="href">
                    <xsl:call-template name="href.target">
                      <xsl:with-param name="object" select="$home"/>
                    </xsl:call-template>
                  </xsl:attribute>
                  <img src="home.png" width="24" height="24" border="0">
                    <xsl:attribute name="alt">
                      <xsl:call-template name="gentext">
                        <xsl:with-param name="key">nav-home</xsl:with-param>
                      </xsl:call-template>
                    </xsl:attribute>
                  </img>
                </a>
              </td>
            </xsl:when>
            <xsl:otherwise>
              <td>&#160;</td>
            </xsl:otherwise>
          </xsl:choose>
          <th width="100%" align="center">
            <xsl:apply-templates select="$home" mode="object.title.markup"/>
          </th>
          <xsl:choose>
            <xsl:when test="count($next) > 0">
              <td>
                <a accesskey="n">
                  <xsl:attribute name="href">
                    <xsl:call-template name="href.target">
                      <xsl:with-param name="object" select="$next"/>
                    </xsl:call-template>
                  </xsl:attribute>
                  <img src="right.png" width="24" height="24" border="0">
                    <xsl:attribute name="alt">
                      <xsl:call-template name="gentext">
                        <xsl:with-param name="key">nav-next</xsl:with-param>
                      </xsl:call-template>
                    </xsl:attribute>
                  </img>
                </a>
              </td>
            </xsl:when>
            <xsl:otherwise>
              <td>&#160;</td>
            </xsl:otherwise>
          </xsl:choose>
        </tr>
        <!--<xsl:if test="name()='refentry'"-->
        <xsl:choose>
          <xsl:when test="count($refsections) > 0">
            <tr>
              <td colspan="5" class="shortcuts">
                <xsl:if test="count($sect_synopsis) > 0">
                  <a href="#{$section_id}.synopsis" class="shortcut">Top</a>
                </xsl:if>
                <xsl:if test="count($sect_desc) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.description" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='desc']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_object_hierarchy) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.object-hierarchy" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='object_hierarchy']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_impl_interfaces) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.implemented-interfaces" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='impl_interfaces']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_prerequisites) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.prerequisites" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='prerequisites']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_derived_interfaces) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.derived-interfaces" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='derived_interfaces']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_implementations) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.implementations" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='implementations']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_properties) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.properties" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='properties']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_child_properties) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.child-properties" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='child_properties']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_style_properties) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.style-properties" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='style_properties']/title"/>
                  </a>
                </xsl:if>
                <xsl:if test="count($sect_signal_proto) > 0">
                  &#160;|&#160;
                  <a href="#{$section_id}.signals" class="shortcut">
                    <xsl:value-of select="./refsect1[@role='signal_proto']/title"/>
                  </a>
                </xsl:if>
                <!--
                <xsl:if test="count($sect_details) > 0">
                  <a href="#details" class="shortcut">
                    <xsl:value-of select="./refsect1[@id='details']/title"/>
                  </a>
                  &#160;|&#160;
                </xsl:if>
                <xsl:if test="count($sect_property_details) > 0">
                  <a href="#property_details" class="shortcut">
                    <xsl:value-of select="./refsect1[@id='property_details']/title"/>
                  </a>
                  &#160;|&#160;
                </xsl:if>
                <xsl:if test="count($sect_child_property_details) > 0">
                  <a href="#child_property_details" class="shortcut">
                    <xsl:value-of select="./refsect1[@id='property_child_details']/title"/>
                  </a>
                  &#160;|&#160;
                </xsl:if>
                <xsl:if test="count($sect_style_property_details) > 0">
                  <a href="#style_property_details" class="shortcut">
                    <xsl:value-of select="./refsect1[@id='style_property_details']/title"/>
                  </a>
                  &#160;|&#160;
                </xsl:if>
                <xsl:if test="count($sect_signals) > 0">
                  <a href="#signals" class="shortcut">
                    <xsl:value-of select="./refsect1[@id='signals']/title"/>
                  </a>
                  &#160;|&#160;
                </xsl:if>
                -->
              </td>
            </tr>
          </xsl:when>
          <!-- this is not yet very nice, as it requires all glossdic/indexdiv
          elements having a anchor element. maybe we can customize the xsl
          to automaticaly create local anchors
          -->
          <xsl:when test="count($glssections) > 0">
            <tr>
              <td colspan="5" class="shortcuts">
                 <xsl:for-each select="./glossdiv">
                   <xsl:if test="position() > 1">
                     &#160;|&#160;
                   </xsl:if>
                   <a class="shortcut">
                     <xsl:attribute name="href">#gls<xsl:value-of select="./title"/></xsl:attribute>
                     <xsl:value-of select="./title"/>
                   </a>
                 </xsl:for-each>
              </td>
            </tr>
          </xsl:when>
          <xsl:when test="count($idxsections) > 0">
            <tr>
              <td colspan="5" class="shortcuts">
                 <xsl:for-each select="./indexdiv/indexdiv">
                   <xsl:if test="position() > 1">
                     &#160;|&#160;
                   </xsl:if>
                   <a class="shortcut">
                     <xsl:attribute name="href">#idx<xsl:value-of select="./title"/></xsl:attribute>
                     <xsl:value-of select="./title"/>
                   </a>
                 </xsl:for-each>
              </td>
            </tr>
          </xsl:when>
        </xsl:choose>
      </table>
    </xsl:if>
  </xsl:template>

  <xsl:template name="footer.navigation">
  </xsl:template>

  <!-- avoid creating multiple identical indices
       if the stylesheets don't support filtered indices
    -->
  <xsl:template match="index">
    <xsl:variable name="has-filtered-index">
      <xsl:call-template name="version-greater-or-equal">
        <xsl:with-param name="ver1" select="$VERSION" />
        <xsl:with-param name="ver2">1.66</xsl:with-param>
      </xsl:call-template>
    </xsl:variable>
    <xsl:if test="($has-filtered-index = 1) or (count(@role) = 0)">
      <xsl:apply-imports/>
    </xsl:if>
  </xsl:template>

  <xsl:template match="index" mode="toc">
    <xsl:variable name="has-filtered-index">
      <xsl:call-template name="version-greater-or-equal">
        <xsl:with-param name="ver1" select="$VERSION" />
        <xsl:with-param name="ver2">1.66</xsl:with-param>
      </xsl:call-template>
    </xsl:variable>
    <xsl:if test="($has-filtered-index = 1) or (count(@role) = 0)">
      <xsl:apply-imports/>
    </xsl:if>
  </xsl:template>

  <xsl:template match="para">
    <xsl:choose>
      <xsl:when test="@role = 'gallery'">
         <div class="container">
           <div class="gallery-spacer"> </div>
           <xsl:apply-templates mode="gallery.mode"/>
           <div class="gallery-spacer"> </div>
         </div>
      </xsl:when>
      <xsl:otherwise>
        <xsl:apply-imports/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <!-- FIXME: try if that works too -->
  <!--xsl:template match="para[@role='gallery']">
    <div class="container">
      <div class="gallery-spacer"> </div>
      <xsl:apply-templates mode="gallery.mode"/>
      <div class="gallery-spacer"> </div>
    </div>
  </xsl:template-->



  <xsl:template match="link" mode="gallery.mode">
    <div class="gallery-float">
       <xsl:apply-templates select="."/>
    </div>
  </xsl:template>

  <!-- add gallery handling to refnamediv template -->
  <xsl:template match="refnamediv">
    <div class="{name(.)}">
      <table width="100%">
        <tr><td valign="top">
          <xsl:call-template name="anchor"/>
            <xsl:choose>
              <xsl:when test="$refentry.generate.name != 0">
                <h2>
                <xsl:call-template name="gentext">
                    <xsl:with-param name="key" select="'RefName'"/>
                  </xsl:call-template>
                </h2>
              </xsl:when>
              <xsl:when test="$refentry.generate.title != 0">
                <h2>
                  <xsl:choose>
                    <xsl:when test="../refmeta/refentrytitle">
                      <xsl:apply-templates select="../refmeta/refentrytitle"/>
                    </xsl:when>
                    <xsl:otherwise>
                      <xsl:apply-templates select="refname[1]"/>
                    </xsl:otherwise>
                  </xsl:choose>
                </h2>
              </xsl:when>
            </xsl:choose>
            <p>
            <xsl:apply-templates/>
          </p>
        </td>
        <td valign="top" align="right">
          <xsl:choose>
            <xsl:when test="../refmeta/refmiscinfo/inlinegraphic">
              <xsl:apply-templates select="../refmeta/refmiscinfo/inlinegraphic"/>
            </xsl:when>
            <xsl:otherwise>
              <!-- find the gallery image to use here
                   - determine the id of the enclosing refentry
                   - look for an inlinegraphic inside a link with linkend == refentryid inside a para with role == gallery
                   - use it here
                -->
              <xsl:variable name="refentryid" select="../@id"/>
	      <xsl:apply-templates select="key('gallery.key', $refentryid)/inlinegraphic"/>
            </xsl:otherwise>
          </xsl:choose>
        </td></tr>
       </table>
     </div>
  </xsl:template>

  <!-- add anchors for index sections -->
  <xsl:template match="indexdiv">
    <a><xsl:attribute name="name">idx<xsl:value-of select="./title"/></xsl:attribute></a>
    <xsl:apply-templates/>
  </xsl:template>

  <!-- add anchors for glossary sections -->
  <xsl:template match="glossdiv">
    <a><xsl:attribute name="name">gls<xsl:value-of select="./title"/></xsl:attribute></a>
    <xsl:apply-templates/>
  </xsl:template>

  <!-- Exterminate any trace of indexterms in the main flow -->
  <xsl:template match="indexterm">
  </xsl:template>

  <!-- Extra link on the right side of doc-blobs -->
  <xsl:template name="user.format.extralinks">
    <xsl:if test="../ulink[@role='extralinks']">
      <span class="extralinks">
        <xsl:for-each select="../ulink[@role='extralinks']">
          <xsl:if test="position() = 1">[&#160;</xsl:if>
          <xsl:if test="position() > 1">&#160;|&#160;</xsl:if>
          <a>
            <xsl:attribute name="href"><xsl:value-of select="@url"/></xsl:attribute>
            <xsl:copy-of select="text()" />
          </a>
          <xsl:if test="position() = last()">&#160;]</xsl:if>
        </xsl:for-each>
      </span>
    </xsl:if>
    <!--xsl:copy-of select="text()" /-->
    <xsl:apply-templates/>
  </xsl:template>

  <!-- this is not in use yet (see gtkdoc-mkdb
  <xsl:template match="//refsect2/ulink[@role='extralinks']"/>
  <xsl:template match="//refsect1/ulink[@role='extralinks']"/>

  <xsl:template match="//refsect2/title">
    <h3><xsl:call-template name="user.format.extralinks"/></h3>
  </xsl:template>

  <xsl:template match="//refsect1/title">
    <h2><xsl:call-template name="user.format.extralinks"/></h2>
  </xsl:template>
  -->

  <!-- ==================================================================== -->

  <xsl:template match="acronym">
    <xsl:call-template name="generate.acronym.link"/>
  </xsl:template>

  <xsl:template name="generate.acronym.link">
    <xsl:param name="acronym">
      <xsl:apply-templates/>
    </xsl:param>
    <!--
      We use for-each to change context to the database document because key()
      only locates elements in the same document as the context node!
    -->

    <xsl:param name="value" >
      <xsl:value-of select="key('acronym.key', $acronym)/../glossdef/para[1]" />
    </xsl:param>
    <xsl:choose>
      <xsl:when test="$value=''">
        <!-- debug -->
        <xsl:message>
          In gtk-doc.xsl: For acronym (<xsl:value-of select="$acronym"/>) no value found!
        </xsl:message>
        <a>
          <xsl:attribute name="href">
            <xsl:text>http://foldoc.org/</xsl:text>
	        <xsl:value-of select="$acronym"/>
          </xsl:attribute>
          <xsl:call-template name="inline.charseq"/>
        </a>
      </xsl:when>
      <xsl:otherwise>
        <!-- found -->
        <acronym>
          <xsl:attribute name="title">
            <xsl:value-of select="$value"/>
          </xsl:attribute>
          <xsl:call-template name="inline.charseq"/>
        </acronym>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

</xsl:stylesheet>
