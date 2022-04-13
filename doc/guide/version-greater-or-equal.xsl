<?xml version='1.0'?> <!--*- mode: xml -*-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="1.0"
                xmlns="http://www.w3.org/TR/xhtml1/transitional"
                exclude-result-prefixes="#default">
 <xsl:template name="version-greater-or-equal">
  <xsl:param name="ver1"></xsl:param>
  <xsl:param name="ver2"></xsl:param>
  <xsl:variable name="vp1">
    <xsl:choose>
      <xsl:when test="contains($ver1, '.')">
        <xsl:value-of select="substring-before($ver1, '.')"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:value-of select="$ver1"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:variable>
  <xsl:variable name="vp2">
    <xsl:choose>
      <xsl:when test="contains($ver2, '.')">
        <xsl:value-of select="substring-before($ver2, '.')"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:value-of select="$ver2"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:variable>
  <xsl:choose>
    <xsl:when test="$vp1 &gt; $vp2">
      1
    </xsl:when>
    <xsl:when test="$vp1 &lt; $vp2">
      0
    </xsl:when>
    <xsl:when test="$vp1 = $vp2">
      <xsl:choose>
        <xsl:when test="contains($ver1, '.') and contains($ver2, '.')">
          <xsl:call-template name="version-greater-or-equal">
            <xsl:with-param name="ver1" select="substring-after($ver1, '.')"/>
            <xsl:with-param name="ver2" select="substring-after($ver2, '.')"/>
          </xsl:call-template>
	</xsl:when>
        <xsl:when test="contains($ver2, '.')">
	   0
	</xsl:when>
	<xsl:otherwise>
	   1
	</xsl:otherwise>
      </xsl:choose>
    </xsl:when>
  </xsl:choose>
</xsl:template>
</xsl:stylesheet>
