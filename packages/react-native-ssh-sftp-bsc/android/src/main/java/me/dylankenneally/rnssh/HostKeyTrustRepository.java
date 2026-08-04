package me.dylankenneally.rnssh;

import android.util.Base64;

import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class HostKeyTrustRepository implements HostKeyRepository {
  static final int DECISION_NONE = 0;
  static final int DECISION_UNKNOWN = 1;
  static final int DECISION_CHANGED = 2;
  static final int DECISION_PIN_MISMATCH = 3;

  private final HostKeyRepository delegate;
  private final String host;
  private final int port;
  private final String pinnedFingerprint;
  private final boolean acceptNewHostKey;

  private int decision = DECISION_NONE;
  private String presentedType;
  private String presentedFingerprint;

  HostKeyTrustRepository(
      HostKeyRepository delegate,
      String host,
      int port,
      String pinnedFingerprint,
      boolean acceptNewHostKey
  ) {
    this.delegate = delegate;
    this.host = host;
    this.port = port;
    this.pinnedFingerprint = normalizeFingerprint(pinnedFingerprint);
    this.acceptNewHostKey = acceptNewHostKey;
  }

  @Override
  public int check(String requestedHost, byte[] key) {
    try {
      presentedType = new HostKey(requestedHost, key).getType();
    } catch (Exception error) {
      decision = DECISION_UNKNOWN;
      return NOT_INCLUDED;
    }
    presentedFingerprint = fingerprint(key);

    if (pinnedFingerprint != null) {
      if (!pinnedFingerprint.equals(presentedFingerprint)) {
        decision = DECISION_PIN_MISMATCH;
        return CHANGED;
      }
      decision = DECISION_NONE;
      return OK;
    }

    int result = delegate.check(requestedHost, key);
    if (result != OK && !canonicalHost().equals(requestedHost)) {
      result = delegate.check(canonicalHost(), key);
    }
    if (result == OK) {
      decision = DECISION_NONE;
      return OK;
    }
    if (result == CHANGED) {
      decision = DECISION_CHANGED;
      return CHANGED;
    }
    if (acceptNewHostKey) {
      try {
        String hostEntry = canonicalHost();
        delegate.add(new HostKey(hostEntry, key), null);
        decision = DECISION_NONE;
        return OK;
      } catch (Exception error) {
        decision = DECISION_UNKNOWN;
        return NOT_INCLUDED;
      }
    }
    decision = DECISION_UNKNOWN;
    return NOT_INCLUDED;
  }

  @Override
  public void add(HostKey hostkey, com.jcraft.jsch.UserInfo userinfo) {
    delegate.add(hostkey, userinfo);
  }

  @Override
  public void remove(String host, String type) {
    delegate.remove(host, type);
  }

  @Override
  public void remove(String host, String type, byte[] key) {
    delegate.remove(host, type, key);
  }

  @Override
  public HostKey[] getHostKey() {
    return delegate.getHostKey();
  }

  @Override
  public HostKey[] getHostKey(String host, String type) {
    return delegate.getHostKey(host, type);
  }

  @Override
  public String getKnownHostsRepositoryID() {
    return delegate.getKnownHostsRepositoryID();
  }

  int getDecision() {
    return decision;
  }

  String getPresentedType() {
    return presentedType;
  }

  String getPresentedFingerprint() {
    return presentedFingerprint;
  }

  private String canonicalHost() {
    return port == 22 ? host : "[" + host + "]:" + port;
  }

  static String fingerprint(byte[] key) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(key);
      return "SHA256:" + Base64.encodeToString(digest, Base64.NO_WRAP).replace("=", "");
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA-256 is unavailable", error);
    }
  }

  private static String normalizeFingerprint(String value) {
    if (value == null) return null;
    String normalized = value.trim();
    if (normalized.startsWith("SHA256:") || normalized.startsWith("SHA256/")) {
      normalized = normalized.substring(7);
    }
    normalized = normalized.replace("=", "");
    return normalized.isEmpty() ? null : "SHA256:" + normalized;
  }
}
