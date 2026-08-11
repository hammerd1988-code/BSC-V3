# JSch creates cipher, MAC, key-exchange, and compression implementations by
# fully-qualified class name during SSH negotiation.
-keep class com.jcraft.jsch.** { *; }
-dontwarn com.jcraft.jsch.**

# JSch can load the bundled Bouncy Castle provider reflectively.
-keep class org.bouncycastle.** { *; }
-dontwarn org.bouncycastle.**
